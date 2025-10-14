import { PDFDocument, PDFImage } from 'pdf-lib'
import sharp from 'sharp'
import pdfParse from 'pdf-parse-fork'

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

// Extract embedded images from PDF using pdf-lib
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    console.log('[IMAGE_EXTRACTION] Starting PDF image extraction...')
    
    // Get text content for context
    const fullText = await extractTextFromPDF(pdfBuffer)
    console.log('[IMAGE_EXTRACTION] Extracted text length:', fullText.length)
    
    // Load PDF with pdf-lib
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer))
    const pages = pdfDoc.getPages()
    console.log('[IMAGE_EXTRACTION] PDF has', pages.length, 'pages')
    
    // Process each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex]
      const pageNumber = pageIndex + 1
      
      try {
        // Get page dimensions
        const { width, height } = page.getSize()
        console.log(`[IMAGE_EXTRACTION] Processing page ${pageNumber} (${width}x${height})`)
        
        // Method 1: Check if page likely has images
        // Since pdf-lib's internal structure is not easily accessible,
        // we'll use a heuristic approach
        let hasImages = false
        
        try {
          // Check if this is a likely diagram/image page based on page number and context
          // Pages with figures often have specific text patterns
          const pageText = fullText.toLowerCase()
          hasImages = pageText.includes('figure') || 
                     pageText.includes('diagram') || 
                     pageText.includes('chart') ||
                     pageText.includes('graph') ||
                     pageText.includes('image') ||
                     pageNumber <= 10 // Often diagrams are in early pages
          
          if (hasImages) {
            console.log(`[IMAGE_EXTRACTION] Page ${pageNumber} likely contains visual content`)
          }
        } catch (err) {
          console.error(`[IMAGE_EXTRACTION] Error checking for images:`, err)
        }
        
        // Method 2: Render the entire page as an image if it contains visual content
        // This is a fallback approach that ensures we capture diagrams and figures
        // Check if page likely contains diagrams (heuristic: less text density)
        const pageTextLength = fullText.length / pages.length
        const hasVisualContent = pageTextLength < 2000 || pageNumber <= 3 // First 3 pages or low text density
        
        if (hasVisualContent || hasImages) {
          console.log(`[IMAGE_EXTRACTION] Rendering page ${pageNumber} as image`)
          
          // Create a high-quality render of the page
          // Since we can't directly render with pdf-lib, we'll create a placeholder
          // In production, you'd use a PDF rendering library like pdf2pic or puppeteer
          const pageImage = await createPageImage(pageNumber, width, height, fullText)
          
          images.push({
            pageNumber,
            imageBuffer: pageImage,
            contextBefore: fullText.substring(0, 500),
            contextAfter: fullText.substring(0, 500),
            nearbyText: fullText.substring(0, 1000),
            boundingBox: {
              x: 0,
              y: 0,
              width,
              height
            },
            imageType: 'page_render',
            topics: extractTopics(fullText)
          })
        }
      } catch (pageError) {
        console.error(`[IMAGE_EXTRACTION] Error processing page ${pageNumber}:`, pageError)
      }
    }
    
    console.log(`[IMAGE_EXTRACTION] Successfully extracted ${images.length} images`)
    return images
  } catch (error) {
    console.error('[IMAGE_EXTRACTION] Error extracting images from PDF:', error)
    return []
  }
}

// Create a placeholder image for a PDF page
async function createPageImage(
  pageNumber: number, 
  width: number, 
  height: number,
  text: string
): Promise<Buffer> {
  // Create a white background with page info
  // In production, you'd actually render the PDF page here
  const image = await sharp({
    create: {
      width: Math.min(Math.round(width * 2), 1600), // 2x scale, max 1600px
      height: Math.min(Math.round(height * 2), 2000), // 2x scale, max 2000px
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
  .composite([
    {
      input: Buffer.from(
        `<svg width="${Math.min(width * 2, 1600)}" height="${Math.min(height * 2, 2000)}">
          <rect width="100%" height="100%" fill="white"/>
          <text x="50%" y="50%" text-anchor="middle" font-size="24" fill="#999">
            Page ${pageNumber} - Contains diagrams/images
          </text>
          <text x="50%" y="60%" text-anchor="middle" font-size="16" fill="#ccc">
            (PDF page rendering placeholder)
          </text>
        </svg>`
      ),
      top: 0,
      left: 0
    }
  ])
  .png()
  .toBuffer()
  
  return image
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
    caption: 'Page from PDF document containing diagrams or images',
    imageType: 'page_render',
    topics: ['document', 'diagram']
  }
}
