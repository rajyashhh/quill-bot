import { PDFDocument } from 'pdf-lib'
const sharp = require('sharp')
import { getDocument, GlobalWorkerOptions, version } from './pdfjs-node'
import { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'

export interface ExtractedImage {
  pageNumber: number
  imageData: Buffer
  caption?: string
  contextBefore: string
  contextAfter: string
  nearbyText: string
  x?: number
  y?: number
  width?: number
  height?: number
  imageType?: string
}

export interface PageText {
  pageNumber: number
  text: string
  items: any[]
}

// Extract text from PDF pages
async function extractTextFromPages(pdfBuffer: Buffer): Promise<PageText[]> {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer) })
  const pdf = await loadingTask.promise
  const pageTexts: PageText[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    
    let pageText = ''
    const items: any[] = []
    
    textContent.items.forEach((item: any) => {
      if ('str' in item) {
        pageText += item.str + ' '
        items.push({
          text: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height
        })
      }
    })
    
    pageTexts.push({
      pageNumber: i,
      text: pageText.trim(),
      items
    })
  }

  return pageTexts
}

// Find caption near an image
function findImageCaption(pageText: PageText, imageY: number): string | undefined {
  const captionPatterns = [
    /(?:Figure|Fig\.?|Diagram|Chart|Table|Image)\s*\d*\.?\d*\s*:?\s*(.+)/i,
    /(?:Exhibit|Illustration|Graph)\s*\d*\.?\d*\s*:?\s*(.+)/i
  ]

  // Look for text items below the image (within reasonable distance)
  const nearbyItems = pageText.items.filter(item => 
    Math.abs(item.y - imageY) < 50 && item.y < imageY
  )

  for (const item of nearbyItems) {
    for (const pattern of captionPatterns) {
      const match = item.text.match(pattern)
      if (match) {
        return match[0]
      }
    }
  }

  return undefined
}

// Get text context around an image
function getImageContext(pageText: PageText, imagePosition: { y: number }): {
  contextBefore: string
  contextAfter: string
  nearbyText: string
} {
  const words = pageText.text.split(' ')
  const contextSize = 100 // words

  // Simple approach - take text before and after based on position
  // In a real implementation, you'd use the actual Y coordinates
  const midPoint = Math.floor(words.length / 2)
  
  const contextBefore = words.slice(Math.max(0, midPoint - contextSize), midPoint).join(' ')
  const contextAfter = words.slice(midPoint, Math.min(words.length, midPoint + contextSize)).join(' ')
  const nearbyText = contextBefore + ' ' + contextAfter

  return {
    contextBefore,
    contextAfter,
    nearbyText
  }
}

// Main function to extract images from PDF
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImage[]> {
  const extractedImages: ExtractedImage[] = []
  
  try {
    // Load PDF document
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer))
    const pages = pdfDoc.getPages()
    
    // Extract text for context
    const pageTexts = await extractTextFromPages(pdfBuffer)
    
    // Process each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex]
      const pageNumber = pageIndex + 1
      const pageText = pageTexts[pageIndex]
      
      // Note: pdf-lib doesn't have a direct API to extract embedded images
      // This is a placeholder - in reality, you'd need to use a different approach
      // For now, we'll skip to the fallback method
      console.log(`Processing page ${pageNumber} with pdf-lib`)
    }
    
    return extractedImages
    
  } catch (error) {
    console.error('Error in PDF image extraction:', error)
    
    // Fallback: Try using pdfjs-dist for image extraction
    return await extractImagesWithPdfJs(pdfBuffer)
  }
}

// Fallback method using pdf.js
async function extractImagesWithPdfJs(pdfBuffer: Buffer): Promise<ExtractedImage[]> {
  const extractedImages: ExtractedImage[] = []
  
  try {
    const loadingTask = getDocument({ data: new Uint8Array(pdfBuffer) })
    const pdf = await loadingTask.promise
    const pageTexts = await extractTextFromPages(pdfBuffer)
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const pageText = pageTexts[pageNum - 1]
      
      // Get page operators
      const ops = await page.getOperatorList()
      
      // Look for image operations
      for (let i = 0; i < ops.fnArray.length; i++) {
        const op = ops.fnArray[i]
        
        // Check for image painting operations
        // Check for image painting operations (OPS enum values)
        if (op === 85 || // paintImageXObject
            op === 86 || // paintInlineImageXObject
            op === 88) {  // paintImageMaskXObject
          
          try {
            // Get image data
            const args = ops.argsArray[i]
            if (!args || args.length === 0) continue
            
            // Extract image info
            const imgData = args[0]
            if (!imgData) continue
            
            // Get viewport for coordinate transformation
            const viewport = page.getViewport({ scale: 1.0 })
            
            // Simple context extraction
            const context = getImageContext(pageText, { y: viewport.height / 2 })
            const caption = findImageCaption(pageText, viewport.height / 2)
            
            // Create a placeholder for now - actual implementation would extract real image data
            const placeholderImage = await sharp({
              create: {
                width: 300,
                height: 200,
                channels: 4,
                background: { r: 240, g: 240, b: 240, alpha: 1 }
              }
            })
            .png()
            .toBuffer()
            
            extractedImages.push({
              pageNumber: pageNum,
              imageData: placeholderImage,
              caption,
              ...context,
              imageType: 'diagram'
            })
            
          } catch (error) {
            console.error(`Error processing image on page ${pageNum}:`, error)
          }
        }
      }
    }
    
    return extractedImages
    
  } catch (error) {
    console.error('Error in fallback image extraction:', error)
    return []
  }
}

// Extract topics from text using simple keyword matching
export function extractTopicsFromText(text: string): string[] {
  const topics: string[] = []
  
  // Aviation-specific keywords
  const aviationKeywords = [
    'angle of attack', 'lift', 'drag', 'thrust', 'weight',
    'airfoil', 'wing', 'fuselage', 'empennage', 'landing gear',
    'altitude', 'airspeed', 'heading', 'navigation', 'weather',
    'takeoff', 'landing', 'cruise', 'climb', 'descent',
    'engine', 'propeller', 'turbine', 'fuel', 'hydraulics',
    'avionics', 'instruments', 'radio', 'transponder', 'radar'
  ]
  
  const lowerText = text.toLowerCase()
  
  for (const keyword of aviationKeywords) {
    if (lowerText.includes(keyword)) {
      topics.push(keyword)
    }
  }
  
  return Array.from(new Set(topics)) // Remove duplicates
}
