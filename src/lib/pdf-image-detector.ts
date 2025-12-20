import { PDFDocument, PDFPage, PDFImage, PDFName, PDFDict, PDFStream } from 'pdf-lib'
import pdfParse from 'pdf-parse-fork'

export interface PageImageInfo {
  pageNumber: number
  hasImages: boolean
  imageCount: number
  hasText: boolean
  textLength: number
  imageTypes: string[]
}

/**
 * Detects which pages in a PDF contain actual images/diagrams
 * This allows us to only extract pages that have visual content
 */
export async function detectPagesWithImages(pdfBuffer: Buffer): Promise<PageImageInfo[]> {
  const pageInfo: PageImageInfo[] = []

  try {
    console.log('[IMAGE_DETECTOR] Starting PDF image detection...')

    // Load PDF with pdf-lib to analyze structure - handle encrypted PDFs
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), { ignoreEncryption: true })
    const pageCount = pdfDoc.getPageCount()
    console.log(`[IMAGE_DETECTOR] PDF has ${pageCount} pages`)

    // Also get text content for context
    const pdfData = await pdfParse(pdfBuffer)
    const fullText = pdfData.text

    // Analyze each page
    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.getPage(i)
      const pageNum = i + 1

      // Get page resources
      const resources = page.node.Resources()
      const xObjects = resources?.lookup(PDFName.of('XObject'))

      let hasImages = false
      let imageCount = 0
      const imageTypes: string[] = []

      // Check for XObjects (which include images)
      if (xObjects instanceof PDFDict) {
        const keys = xObjects.keys()

        for (const key of keys) {
          const xObject = xObjects.lookup(key)
          if (xObject instanceof PDFStream) {
            const subtype = xObject.dict.lookup(PDFName.of('Subtype'))
            if (subtype && subtype.toString() === '/Image') {
              hasImages = true
              imageCount++

              // Try to determine image type
              const filter = xObject.dict.lookup(PDFName.of('Filter'))
              if (filter) {
                const filterName = filter.toString()
                if (filterName.includes('DCT')) imageTypes.push('JPEG')
                else if (filterName.includes('Flate')) imageTypes.push('PNG')
                else if (filterName.includes('JBIG2')) imageTypes.push('JBIG2')
                else imageTypes.push('Unknown')
              }
            }
          }
        }
      }

      // Check page content stream for image operations
      const contentStream = page.node.Contents()
      if (contentStream && !hasImages) {
        try {
          const content = contentStream.toString()
          // Look for image drawing operations
          if (content.includes(' Do') || content.includes('/Image') ||
            content.includes('BI') || content.includes('ID') || content.includes('EI')) {
            hasImages = true
            if (imageCount === 0) imageCount = 1 // At least one inline image
          }
        } catch (e) {
          // Content stream might be compressed, that's okay
        }
      }

      // Estimate text content for this page
      // This is approximate since we can't easily split text by page
      const pageTextEstimate = Math.floor(fullText.length / pageCount)
      const hasText = pageTextEstimate > 50 // More than 50 chars suggests real text content

      pageInfo.push({
        pageNumber: pageNum,
        hasImages,
        imageCount,
        hasText,
        textLength: pageTextEstimate,
        imageTypes: [...new Set(imageTypes)] // Remove duplicates
      })

      if (hasImages) {
        console.log(`[IMAGE_DETECTOR] Page ${pageNum}: Found ${imageCount} images (${imageTypes.join(', ')})`)
      }
    }

    // Summary
    const pagesWithImages = pageInfo.filter(p => p.hasImages)
    console.log(`[IMAGE_DETECTOR] Total pages with images: ${pagesWithImages.length} out of ${pageCount}`)
    console.log(`[IMAGE_DETECTOR] Pages with images: ${pagesWithImages.map(p => p.pageNumber).join(', ')}`)

    return pageInfo

  } catch (error) {
    console.error('[IMAGE_DETECTOR] Error detecting images:', error)
    throw error
  }
}

/**
 * Get list of page numbers that contain images
 */
export function getPagesWithImages(pageInfo: PageImageInfo[]): number[] {
  return pageInfo
    .filter(p => p.hasImages)
    .map(p => p.pageNumber)
}

/**
 * Intelligently select which pages to extract based on image content and distribution
 */
export function selectPagesToExtract(pageInfo: PageImageInfo[], maxPages: number = 50): number[] {
  const pagesWithImages = pageInfo.filter(p => p.hasImages)

  if (pagesWithImages.length === 0) {
    console.log('[IMAGE_DETECTOR] No pages with images found')
    return []
  }

  if (pagesWithImages.length <= maxPages) {
    // Extract all pages with images if under limit
    return pagesWithImages.map(p => p.pageNumber)
  }

  // If too many pages, prioritize based on:
  // 1. Pages with more images
  // 2. Even distribution throughout document
  const sortedPages = [...pagesWithImages].sort((a, b) => b.imageCount - a.imageCount)

  // Take top pages by image count
  const selectedPages = sortedPages.slice(0, maxPages).map(p => p.pageNumber)

  // Sort by page number for sequential processing
  return selectedPages.sort((a, b) => a - b)
}
