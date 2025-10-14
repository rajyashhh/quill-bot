import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { getDocument, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs-node'

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

interface PageTextContent {
  pageNumber: number
  text: string
  textItems: Array<{
    text: string
    x: number
    y: number
    width: number
    height: number
  }>
}

// Extract all text content from PDF
export async function extractTextFromPDF(pdfBuffer: Buffer): Promise<PageTextContent[]> {
  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise
  const pageContents: PageTextContent[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    
    const textItems = textContent.items
      .filter((item: any) => item.str && item.str.trim())
      .map((item: any) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width || 0,
        height: item.height || 0
      }))

    const fullText = textItems.map((item: { text: string }) => item.text).join(' ')
    
    pageContents.push({
      pageNumber: i,
      text: fullText,
      textItems
    })
  }

  return pageContents
}

// Find caption text near a position
function findCaption(textItems: any[], imageY: number, pageHeight: number): string | undefined {
  // Look for text below the image (within 100 units)
  const captionCandidates = textItems.filter(item => {
    const distance = Math.abs(item.y - imageY)
    return distance < 100 && item.y < imageY
  })

  // Caption patterns
  const patterns = [
    /^(?:Figure|Fig\.?|Diagram|Chart|Table|Image)\s*\d*\.?\d*\s*:?\s*/i,
    /^(?:Exhibit|Illustration|Graph|Picture)\s*\d*\.?\d*\s*:?\s*/i
  ]

  for (const item of captionCandidates) {
    for (const pattern of patterns) {
      if (pattern.test(item.text)) {
        // Get the full caption (might span multiple text items)
        const captionStart = textItems.indexOf(item)
        let caption = item.text
        
        // Add following text items that are on similar Y position
        for (let i = captionStart + 1; i < textItems.length; i++) {
          if (Math.abs(textItems[i].y - item.y) < 5) {
            caption += ' ' + textItems[i].text
          } else {
            break
          }
        }
        
        return caption.trim()
      }
    }
  }

  return undefined
}

// Get surrounding text context
function getTextContext(pageText: string, position: number = 0.5): {
  contextBefore: string
  contextAfter: string
  nearbyText: string
} {
  const words = pageText.split(/\s+/)
  const contextWords = 150 // Number of words for context
  
  const splitPoint = Math.floor(words.length * position)
  
  const beforeStart = Math.max(0, splitPoint - contextWords)
  const beforeEnd = splitPoint
  const afterStart = splitPoint
  const afterEnd = Math.min(words.length, splitPoint + contextWords)
  
  const contextBefore = words.slice(beforeStart, beforeEnd).join(' ')
  const contextAfter = words.slice(afterStart, afterEnd).join(' ')
  const nearbyText = words.slice(beforeStart, afterEnd).join(' ')

  return {
    contextBefore: contextBefore.substring(0, 500), // Limit length
    contextAfter: contextAfter.substring(0, 500),
    nearbyText: nearbyText.substring(0, 1000)
  }
}

// Extract aviation-related topics
function extractTopics(text: string): string[] {
  const topics = new Set<string>()
  const lowerText = text.toLowerCase()
  
  const topicPatterns = [
    // Aerodynamics
    { pattern: /angle of attack|aoa/g, topic: 'angle of attack' },
    { pattern: /lift(?:ing)?\s+(?:force|coefficient)?/g, topic: 'lift' },
    { pattern: /drag\s+(?:force|coefficient)?/g, topic: 'drag' },
    { pattern: /thrust/g, topic: 'thrust' },
    { pattern: /airfoil|aerofoil/g, topic: 'airfoil' },
    { pattern: /bernoulli/g, topic: 'bernoulli principle' },
    
    // Aircraft parts
    { pattern: /wing(?:s)?/g, topic: 'wing' },
    { pattern: /fuselage/g, topic: 'fuselage' },
    { pattern: /empennage|tail/g, topic: 'empennage' },
    { pattern: /landing gear/g, topic: 'landing gear' },
    { pattern: /control surface/g, topic: 'control surfaces' },
    
    // Flight operations
    { pattern: /takeoff|take-off/g, topic: 'takeoff' },
    { pattern: /landing/g, topic: 'landing' },
    { pattern: /cruise/g, topic: 'cruise' },
    { pattern: /climb/g, topic: 'climb' },
    { pattern: /descent/g, topic: 'descent' },
    
    // Navigation
    { pattern: /navigation|nav/g, topic: 'navigation' },
    { pattern: /vor|vhf omnidirectional range/g, topic: 'VOR' },
    { pattern: /ils|instrument landing system/g, topic: 'ILS' },
    { pattern: /gps|global positioning system/g, topic: 'GPS' },
    
    // Weather
    { pattern: /weather/g, topic: 'weather' },
    { pattern: /wind/g, topic: 'wind' },
    { pattern: /turbulence/g, topic: 'turbulence' },
    { pattern: /icing/g, topic: 'icing' },
    
    // Instruments
    { pattern: /altimeter/g, topic: 'altimeter' },
    { pattern: /airspeed indicator/g, topic: 'airspeed indicator' },
    { pattern: /attitude indicator/g, topic: 'attitude indicator' },
    { pattern: /compass/g, topic: 'compass' }
  ]
  
  for (const { pattern, topic } of topicPatterns) {
    if (pattern.test(lowerText)) {
      topics.add(topic)
    }
  }
  
  return Array.from(topics)
}

// Main extraction function - simplified approach
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    // Extract text content first
    const pageTexts = await extractTextFromPDF(pdfBuffer)
    
    // Load PDF with pdf-lib
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer))
    const pages = pdfDoc.getPages()
    
    // Use pdfjs for better image extraction
    const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const pageText = pageTexts[pageNum - 1]
      
      // Get page operations
      const ops = await page.getOperatorList()
      
      // Track image position for context
      let imageCount = 0
      const pageHeight = page.getViewport({ scale: 1 }).height
      
      for (let i = 0; i < ops.fnArray.length; i++) {
        const op = ops.fnArray[i]
        
        // Check for image operations
        if (op === 13 || op === 85 || op === 91) { // paintImageXObject, paintInlineImageXObject, paintImageMaskXObject
          imageCount++
          
          // Estimate position based on image count (simplified)
          const estimatedY = pageHeight - (pageHeight / (imageCount + 1) * imageCount)
          
          // Find caption
          const caption = findCaption(pageText.textItems, estimatedY, pageHeight)
          
          // Get context based on position
          const position = imageCount / (imageCount + 2) // Rough position estimate
          const context = getTextContext(pageText.text, position)
          
          // Extract topics
          const topics = extractTopics(context.nearbyText + ' ' + (caption || ''))
          
          // Determine image type from caption or context
          let imageType = 'diagram'
          const combinedText = (caption || '') + ' ' + context.nearbyText
          if (/chart|graph/i.test(combinedText)) imageType = 'chart'
          else if (/table/i.test(combinedText)) imageType = 'table'
          else if (/photo/i.test(combinedText)) imageType = 'photo'
          
          // For now, create a placeholder image
          // In production, you'd extract the actual image data
          const placeholderBuffer = await sharp({
            create: {
              width: 400,
              height: 300,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
          })
          .png()
          .toBuffer()
          
          images.push({
            pageNumber: pageNum,
            imageBuffer: placeholderBuffer,
            caption,
            ...context,
            boundingBox: {
              x: 0,
              y: estimatedY,
              width: 400,
              height: 300
            },
            imageType,
            topics
          })
        }
      }
    }
    
    return images
    
  } catch (error) {
    console.error('Error extracting images:', error)
    return []
  }
}

// Helper to check if buffer is a valid image
async function isValidImage(buffer: Buffer): Promise<boolean> {
  try {
    const metadata = await sharp(buffer).metadata()
    return !!(metadata.width && metadata.height)
  } catch {
    return false
  }
}

// Convert image to PNG if needed
export async function convertImageToPNG(imageBuffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(imageBuffer)
      .png()
      .toBuffer()
  } catch (error) {
    console.error('Error converting image:', error)
    throw error
  }
}
