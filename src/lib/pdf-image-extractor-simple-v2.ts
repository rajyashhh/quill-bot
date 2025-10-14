import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import pdfParse from 'pdf-parse-fork'
import { createCanvas } from 'canvas'

// Use dynamic import for pdfjs-dist to handle ESM
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')
pdfjsLib.GlobalWorkerOptions.workerSrc = false

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
async function extractTextFromPDF(pdfBuffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(pdfBuffer)
    return data.text
  } catch (error) {
    console.error('Error extracting text:', error)
    return ''
  }
}

// Convert PDF pages to images using pdf.js
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    console.log('Starting PDF image extraction...')
    
    // Get text content for context
    const fullText = await extractTextFromPDF(pdfBuffer)
    
    // Load PDF with pdfjs
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      disableFontFace: true,
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
      cMapPacked: true,
    })
    
    const pdfDoc = await loadingTask.promise
    const numPages = pdfDoc.numPages
    
    console.log(`Processing ${numPages} pages...`)
    
    // Process each page
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      try {
        const page = await pdfDoc.getPage(pageNum)
        
        // Get page dimensions
        const viewport = page.getViewport({ scale: 2.0 }) // Higher scale for better quality
        const { width, height } = viewport
        
        // Create canvas
        const canvas = createCanvas(width, height)
        const context = canvas.getContext('2d')
        
        // Render page to canvas
        await page.render({
          canvasContext: context as any, // pdfjs-dist expects a different context type
          viewport: viewport,
        }).promise
        
        // Convert canvas to buffer
        const imageBuffer = await new Promise<Buffer>((resolve, reject) => {
          canvas.toBuffer((err: Error | null, buffer: Buffer) => {
            if (err) reject(err)
            else resolve(buffer)
          }, 'image/png')
        })
        
        // Check if page has significant content (not just text)
        // This is a simple heuristic - you might want to improve this
        const operators = await page.getOperatorList()
        const hasImages = operators.fnArray.some((op: number) => 
          op === 85 || // paintImageXObject
          op === 86 || // paintInlineImageXObject  
          op === 88    // paintImageMaskXObject
        )
        
        // Only save if page likely contains diagrams/images
        if (hasImages || pageNum === 1) { // Always include first page
          images.push({
            pageNumber: pageNum,
            imageBuffer,
            contextBefore: fullText.substring(0, 500),
            contextAfter: fullText.substring(0, 500),
            nearbyText: fullText.substring(0, 1000),
            boundingBox: {
              x: 0,
              y: 0,
              width: viewport.width,
              height: viewport.height
            },
            imageType: hasImages ? 'diagram' : 'page',
            topics: []
          })
          
          console.log(`Extracted image from page ${pageNum}`)
        }
      } catch (pageError) {
        console.error(`Error processing page ${pageNum}:`, pageError)
      }
    }
    
    console.log(`Successfully extracted ${images.length} images`)
    return images
  } catch (error) {
    console.error('Error extracting images from PDF:', error)
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
    caption: 'Extracted diagram from PDF',
    imageType: 'diagram',
    topics: ['extracted']
  }
}
