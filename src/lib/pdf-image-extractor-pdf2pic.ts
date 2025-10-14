import { fromPath, fromBuffer } from 'pdf2pic'
import pdfParse from 'pdf-parse-fork'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'

export interface ExtractedImageData {
  pageNumber: number
  imageBuffer: Buffer
  imageUrl?: string // Will be set after upload
  imageKey?: string // UploadThing key
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

// Extract text from PDF using pdf-parse-fork
async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(pdfBuffer)
    return data.text
  } catch (error) {
    console.error('Error extracting text:', error)
    return ''
  }
}

// Extract images from PDF by converting pages to images
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    console.log('[IMAGE_EXTRACTION] Starting PDF image extraction with pdf2pic...')
    
    // Get text content for context
    const fullText = await extractTextFromPDF(pdfBuffer)
    console.log('[IMAGE_EXTRACTION] Extracted text length:', fullText.length)
    
    // Get page count
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer))
    const pageCount = pdfDoc.getPageCount()
    console.log('[IMAGE_EXTRACTION] PDF has', pageCount, 'pages')
    
    // Create a temporary file for pdf2pic (it works better with file paths)
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-extract-'))
    const tempPdfPath = path.join(tempDir, 'temp.pdf')
    await fs.writeFile(tempPdfPath, new Uint8Array(pdfBuffer))
    
    try {
      // Configure pdf2pic
      const options = {
        density: 150,           // DPI
        saveFilename: 'page',   // Output filename
        savePath: tempDir,      // Output directory
        format: 'png',          // Output format
        width: 1200,            // Max width
        height: 1600            // Max height
      }
      
      const converter = fromPath(tempPdfPath, options)
      
      // Determine which pages to extract
      // Extract pages that likely contain diagrams/images
      const pagesToExtract: number[] = []
      
      // Always include first few pages (often contain diagrams)
      for (let i = 1; i <= Math.min(5, pageCount); i++) {
        pagesToExtract.push(i)
      }
      
      // Check for pages with figure references
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
      console.log('[IMAGE_EXTRACTION] Extracting pages:', uniquePages)
      
      // Convert selected pages to images
      for (const pageNumber of uniquePages) {
        try {
          console.log(`[IMAGE_EXTRACTION] Converting page ${pageNumber} to image...`)
          
          // Convert page to image
          const result = await converter(pageNumber)
          
          if (result && result.path) {
            // Read the generated image
            const imageBuffer = await fs.readFile(result.path)
            
            // Extract context for this page
            const pageTextStart = Math.floor((pageNumber - 1) * fullText.length / pageCount)
            const pageTextEnd = Math.floor(pageNumber * fullText.length / pageCount)
            const pageContext = fullText.substring(pageTextStart, pageTextEnd)
            
            images.push({
              pageNumber,
              imageBuffer,
              contextBefore: pageContext.substring(0, 500),
              contextAfter: pageContext.substring(0, 500),
              nearbyText: pageContext.substring(0, 1000),
              imageType: 'page_render',
              topics: extractTopics(pageContext)
            })
            
            // Clean up the generated image file
            await fs.unlink(result.path).catch(() => {})
          }
        } catch (pageError) {
          console.error(`[IMAGE_EXTRACTION] Error converting page ${pageNumber}:`, pageError)
        }
      }
    } finally {
      // Clean up temp files
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.error('[IMAGE_EXTRACTION] Error cleaning up temp files:', cleanupError)
      }
    }
    
    console.log(`[IMAGE_EXTRACTION] Successfully extracted ${images.length} page images`)
    return images
  } catch (error) {
    console.error('[IMAGE_EXTRACTION] Error extracting images from PDF:', error)
    return []
  }
}

// Extract topics from text
function extractTopics(text: string): string[] {
  const topics: string[] = []
  const lowerText = text.toLowerCase()
  
  // Common aviation/technical topics
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

// Analyze image content (placeholder for now)
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
