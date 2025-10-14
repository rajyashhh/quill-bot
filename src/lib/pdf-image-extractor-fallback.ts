import { PDFDocument } from 'pdf-lib'
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

interface PageTextContent {
  pageNumber: number
  text: string
}

// Extract text from PDF using pdf-parse-fork
async function extractTextFromPDF(pdfBuffer: Buffer): Promise<PageTextContent[]> {
  try {
    const data = await pdfParse(pdfBuffer)
    
    // For now, return all text as a single page
    // pdf-parse-fork doesn't provide page-by-page text easily
    return [{
      pageNumber: 1,
      text: data.text
    }]
  } catch (error) {
    console.error('Error extracting text:', error)
    return []
  }
}

// Extract images using pdf-lib
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    // Load PDF with pdf-lib - convert Buffer to Uint8Array - handle encrypted PDFs
    const pdfDoc = await PDFDocument.load(new Uint8Array(pdfBuffer), { ignoreEncryption: true })
    const pages = pdfDoc.getPages()
    
    // Get text content
    const textContents = await extractTextFromPDF(pdfBuffer)
    const fullText = textContents.map(tc => tc.text).join(' ')
    
    // For now, return empty array - image extraction from PDFs is complex
    // and the main goal is to get the server running without pdfjs-dist errors
    console.log('Image extraction temporarily disabled to avoid pdfjs-dist issues')
    
    console.log(`Extracted ${images.length} images from PDF`)
    return images
  } catch (error) {
    console.error('Error extracting images:', error)
    return []
  }
}

// Analyze image content (placeholder for now)
export async function analyzeImageContent(imageBuffer: Buffer): Promise<{
  caption: string
  imageType: string
  topics: string[]
}> {
  // This would normally use AI/ML to analyze the image
  return {
    caption: 'Extracted image from PDF',
    imageType: 'diagram',
    topics: ['general']
  }
}
