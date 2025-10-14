import { v2 as cloudinary } from 'cloudinary'
import pdfParse from 'pdf-parse-fork'
import { PDFDocument } from 'pdf-lib'
import { detectPagesWithImages, selectPagesToExtract } from './pdf-image-detector'

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

// Extract images from PDF using Cloudinary
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    console.log('[CLOUDINARY] Starting PDF image extraction...')
    
    // Get text content for context
    const fullText = await extractTextFromPDF(pdfBuffer)
    console.log('[CLOUDINARY] Extracted text length:', fullText.length)
    
    // Get page count - handle encrypted PDFs
    let pageCount = 0
    try {
      const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), { ignoreEncryption: true })
      pageCount = pdfDoc.getPageCount()
      console.log('[CLOUDINARY] PDF has', pageCount, 'pages')
    } catch (error) {
      console.log('[CLOUDINARY] Could not get page count, assuming 50 pages')
      pageCount = 50 // Default assumption for encrypted PDFs
    }
    
    // Upload PDF to Cloudinary
    // Cloudinary will handle the conversion automatically
    console.log('[CLOUDINARY] Uploading PDF to Cloudinary...')
    
    // Convert buffer to base64 for Cloudinary upload
    const base64Pdf = `data:application/pdf;base64,${pdfBuffer.toString('base64')}`
    
    // Upload the PDF to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(base64Pdf, {
      resource_type: 'image',
      format: 'pdf',
      pages: true, // Enable multi-page support
    })
    
    console.log('[CLOUDINARY] PDF uploaded successfully:', uploadResult.public_id)
    
    // Intelligently detect which pages have images
    console.log('[CLOUDINARY] Detecting pages with images...')
    const pageInfo = await detectPagesWithImages(pdfBuffer)
    
    // Select pages to extract based on image content
    const pagesToExtract = selectPagesToExtract(pageInfo, 30) // Extract up to 30 pages with images
    
    if (pagesToExtract.length === 0) {
      console.log('[CLOUDINARY] No pages with images detected, extracting first 3 pages as fallback')
      // Fallback: extract first 3 pages if no images detected
      for (let i = 1; i <= Math.min(3, pageCount); i++) {
        pagesToExtract.push(i)
      }
    }
    
    console.log(`[CLOUDINARY] Will extract ${pagesToExtract.length} pages with images:`, pagesToExtract)
    
    // Extract each page as an image using Cloudinary's transformation API
    for (const pageNumber of pagesToExtract) {
      try {
        console.log(`[CLOUDINARY] Extracting page ${pageNumber}...`)
        
        // Generate URL for specific page with transformations
        const pageUrl = cloudinary.url(uploadResult.public_id, {
          resource_type: 'image',
          format: 'png',
          page: pageNumber,
          width: 1200,
          height: 1600,
          crop: 'limit',
          quality: 'auto:good',
          dpr: 'auto',
        })
        
        console.log(`[CLOUDINARY] Generated URL for page ${pageNumber}:`, pageUrl)
        
        // Download the image
        const response = await fetch(pageUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch page ${pageNumber}: ${response.statusText}`)
        }
        
        const imageBuffer = Buffer.from(await response.arrayBuffer())
        
        // Extract context for this page
        const pageTextStart = Math.floor((pageNumber - 1) * fullText.length / pageCount)
        const pageTextEnd = Math.floor(pageNumber * fullText.length / pageCount)
        const pageContext = fullText.substring(pageTextStart, pageTextEnd)
        
        images.push({
          pageNumber,
          imageBuffer,
          imageUrl: pageUrl, // Store Cloudinary URL directly
          contextBefore: pageContext.substring(0, 500),
          contextAfter: pageContext.substring(0, 500),
          nearbyText: pageContext.substring(0, 1000),
          imageType: 'page_render',
          topics: extractTopics(pageContext)
        })
        
        console.log(`[CLOUDINARY] Successfully extracted page ${pageNumber}`)
      } catch (pageError) {
        console.error(`[CLOUDINARY] Error extracting page ${pageNumber}:`, pageError)
      }
    }
    
    // Clean up - delete the PDF from Cloudinary after extraction
    try {
      await cloudinary.uploader.destroy(uploadResult.public_id, {
        resource_type: 'image',
        type: 'upload'
      })
      console.log('[CLOUDINARY] Cleaned up temporary PDF')
    } catch (cleanupError) {
      console.error('[CLOUDINARY] Error cleaning up:', cleanupError)
    }
    
    console.log(`[CLOUDINARY] Successfully extracted ${images.length} page images`)
    return images
  } catch (error) {
    console.error('[CLOUDINARY] Error extracting images from PDF:', error)
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
