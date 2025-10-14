import { v2 as cloudinary } from 'cloudinary'
import pdfParse from 'pdf-parse-fork'
import { PDFDocument } from 'pdf-lib'
import { fromBuffer } from 'pdf2pic'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

export interface ExtractedImageData {
  pageNumber: number
  imageBuffer: Buffer
  imageUrl?: string
  imageKey?: string
  caption?: string
  contextBefore: string
  contextAfter: string
  nearbyText: string
  boundingBox?: {
    x: number
    y: number
    width: number
    height: number
  }
  imageType?: string
  topics: string[]
}

// Extract text from PDF
async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(pdfBuffer)
    return data.text
  } catch (error) {
    console.error('Error extracting text:', error)
    return ''
  }
}

// Extract a single page from PDF as a new PDF
async function extractSinglePagePDF(pdfBuffer: Buffer, pageNumber: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), { ignoreEncryption: true })
  const newPdfDoc = await PDFDocument.create()
  
  // Copy the specific page
  const [copiedPage] = await newPdfDoc.copyPages(pdfDoc, [pageNumber - 1])
  newPdfDoc.addPage(copiedPage)
  
  // Save as buffer
  const pdfBytes = await newPdfDoc.save()
  return Buffer.from(pdfBytes)
}

// Convert a single page PDF to image using pdf2pic
async function convertPageToImage(singlePagePdfBuffer: Buffer): Promise<Buffer> {
  // Create temporary directory
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-page-'))
  const tempPdfPath = path.join(tempDir, 'page.pdf')
  
  try {
    // Write single page PDF to temp file
    await fs.writeFile(tempPdfPath, new Uint8Array(singlePagePdfBuffer))
    
    // Configure pdf2pic for single page
    const options = {
      density: 150,
      saveFilename: 'page',
      savePath: tempDir,
      format: 'png',
      width: 1200,
      height: 1600
    }
    
    const converter = fromBuffer(singlePagePdfBuffer, options)
    const result = await converter(1) // Always page 1 since it's a single-page PDF
    
    if (result && result.path) {
      const imageBuffer = await fs.readFile(result.path)
      return imageBuffer
    } else {
      throw new Error('Failed to convert page to image')
    }
  } finally {
    // Clean up temp files
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch (e) {
      console.error('Error cleaning up temp files:', e)
    }
  }
}

// Extract images from PDF by converting specific pages
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    console.log('[PAGE_BY_PAGE] Starting PDF image extraction...')
    
    // Get text content for context
    const fullText = await extractTextFromPDF(pdfBuffer)
    console.log('[PAGE_BY_PAGE] Extracted text length:', fullText.length)
    
    // Get page count - handle encrypted PDFs
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), { ignoreEncryption: true })
    const pageCount = pdfDoc.getPageCount()
    console.log('[PAGE_BY_PAGE] PDF has', pageCount, 'pages')
    
    // Determine which pages to extract
    const pagesToExtract: number[] = []
    
    // Always include first few pages
    for (let i = 1; i <= Math.min(5, pageCount); i++) {
      pagesToExtract.push(i)
    }
    
    // Look for pages with figure references
    const lowerText = fullText.toLowerCase()
    const figureMatches = lowerText.matchAll(/figure\s*(\d+\.?\d*)|fig\.\s*(\d+\.?\d*)|diagram\s*(\d+)/g)
    
    for (const match of figureMatches) {
      const pageHint = parseInt(match[1] || match[2] || match[3])
      if (pageHint && pageHint <= pageCount && !pagesToExtract.includes(pageHint)) {
        pagesToExtract.push(pageHint)
      }
    }
    
    // Sort and limit pages
    const uniquePages = [...new Set(pagesToExtract)].sort((a, b) => a - b).slice(0, 10)
    console.log('[PAGE_BY_PAGE] Extracting pages:', uniquePages)
    
    // Process each page individually
    for (const pageNumber of uniquePages) {
      try {
        console.log(`[PAGE_BY_PAGE] Processing page ${pageNumber}...`)
        
        // Extract single page as PDF
        const singlePagePdf = await extractSinglePagePDF(pdfBuffer, pageNumber)
        console.log(`[PAGE_BY_PAGE] Extracted page ${pageNumber} as PDF (${singlePagePdf.length} bytes)`)
        
        // Convert to image locally
        const imageBuffer = await convertPageToImage(singlePagePdf)
        console.log(`[PAGE_BY_PAGE] Converted page ${pageNumber} to image (${imageBuffer.length} bytes)`)
        
        // Upload just this page image to Cloudinary
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`
        
        console.log(`[PAGE_BY_PAGE] Uploading page ${pageNumber} image to Cloudinary...`)
        const uploadResult = await cloudinary.uploader.upload(base64Image, {
          resource_type: 'image',
          format: 'png',
          folder: 'pdf-pages',
          public_id: `page_${Date.now()}_${pageNumber}`,
          transformation: [
            { width: 1200, height: 1600, crop: 'limit' },
            { quality: 'auto:good' }
          ]
        })
        
        console.log(`[PAGE_BY_PAGE] Page ${pageNumber} uploaded successfully:`, uploadResult.public_id)
        
        // Extract context for this page
        const pageTextStart = Math.floor((pageNumber - 1) * fullText.length / pageCount)
        const pageTextEnd = Math.floor(pageNumber * fullText.length / pageCount)
        const pageContext = fullText.substring(pageTextStart, pageTextEnd)
        
        images.push({
          pageNumber,
          imageBuffer,
          imageUrl: uploadResult.secure_url,
          imageKey: uploadResult.public_id,
          contextBefore: pageContext.substring(0, 500),
          contextAfter: pageContext.substring(0, 500),
          nearbyText: pageContext.substring(0, 1000),
          imageType: 'page_render',
          topics: extractTopics(pageContext)
        })
        
        console.log(`[PAGE_BY_PAGE] Successfully processed page ${pageNumber}`)
      } catch (pageError) {
        console.error(`[PAGE_BY_PAGE] Error processing page ${pageNumber}:`, pageError)
        // Continue with other pages
      }
    }
    
    console.log(`[PAGE_BY_PAGE] Successfully extracted ${images.length} page images`)
    return images
  } catch (error) {
    console.error('[PAGE_BY_PAGE] Error extracting images from PDF:', error)
    return []
  }
}

// Extract topics from text
function extractTopics(text: string): string[] {
  const topics: string[] = []
  const lowerText = text.toLowerCase()
  
  const topicPatterns = [
    { pattern: /altitude|height|flight level/i, topic: 'altitude' },
    { pattern: /pressure|qnh|qfe|sps/i, topic: 'pressure' },
    { pattern: /ifr|vfr|instrument/i, topic: 'flight_rules' },
    { pattern: /navigation|waypoint|route/i, topic: 'navigation' },
    { pattern: /weather|wind|temperature/i, topic: 'weather' },
    { pattern: /aircraft|airplane|helicopter/i, topic: 'aircraft' },
    { pattern: /aerodrome|airport|runway/i, topic: 'aerodrome' }
  ]
  
  for (const { pattern, topic } of topicPatterns) {
    if (pattern.test(lowerText)) {
      topics.push(topic)
    }
  }
  
  return topics.length > 0 ? topics : ['general']
}

// Analyze image content
export async function analyzeImageContent(imageBuffer: Buffer): Promise<{
  caption: string
  imageType: string
  topics: string[]
}> {
  return {
    caption: 'Page from PDF document',
    imageType: 'page_render',
    topics: ['document']
  }
}
