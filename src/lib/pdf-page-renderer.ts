import { PDFDocument } from 'pdf-lib'
import pdfParse from 'pdf-parse-fork'

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
async function extractTextFromPDF(pdfBuffer: Buffer): Promise<{ text: string; numpages: number }> {
  try {
    const data = await pdfParse(pdfBuffer)
    return { text: data.text, numpages: data.numpages }
  } catch (error) {
    console.error('Error extracting text:', error)
    return { text: '', numpages: 0 }
  }
}

// Main function to extract "images" (actually important pages) from PDF
export async function extractImagesFromPDF(pdfBuffer: Buffer): Promise<ExtractedImageData[]> {
  const images: ExtractedImageData[] = []
  
  try {
    console.log('[PDF_RENDERER] Starting PDF page extraction...')
    
    // Get text and page count
    const { text: fullText, numpages } = await extractTextFromPDF(pdfBuffer)
    console.log(`[PDF_RENDERER] PDF has ${numpages} pages with ${fullText.length} characters`)
    
    // Since we can't easily render PDF pages without external dependencies,
    // let's identify which pages likely contain important diagrams/figures
    // and return metadata about them
    
    // Split text roughly by pages (approximate)
    const avgCharsPerPage = fullText.length / numpages
    const pageTexts: string[] = []
    
    for (let i = 0; i < numpages; i++) {
      const start = Math.floor(i * avgCharsPerPage)
      const end = Math.floor((i + 1) * avgCharsPerPage)
      pageTexts.push(fullText.substring(start, end))
    }
    
    // Identify pages with figures/diagrams
    const importantPages: number[] = []
    
    pageTexts.forEach((pageText, index) => {
      const pageNum = index + 1
      const lowerText = pageText.toLowerCase()
      
      // Check for figure/diagram indicators
      const hasFigure = lowerText.includes('figure') || 
                       lowerText.includes('fig.') ||
                       lowerText.includes('diagram') ||
                       lowerText.includes('chart') ||
                       lowerText.includes('graph') ||
                       lowerText.includes('table') ||
                       lowerText.includes('illustration')
      
      // Check for specific content (like your pressure settings diagram)
      const hasSpecificContent = lowerText.includes('altitude') ||
                                lowerText.includes('flight level') ||
                                lowerText.includes('qnh') ||
                                lowerText.includes('qfe') ||
                                lowerText.includes('pressure setting')
      
      if (hasFigure || hasSpecificContent || pageNum <= 5) {
        importantPages.push(pageNum)
      }
    })
    
    // Limit to first 10 important pages
    const pagesToExtract = [...new Set(importantPages)].sort((a, b) => a - b).slice(0, 10)
    console.log('[PDF_RENDERER] Identified important pages:', pagesToExtract)
    
    // For each important page, create a metadata entry
    // In a real implementation, you'd render these pages to images
    for (const pageNum of pagesToExtract) {
      const pageIndex = pageNum - 1
      const pageText = pageTexts[pageIndex] || ''
      
      // Extract topics from page content
      const topics = extractTopics(pageText)
      
      // Create a placeholder entry for this page
      // The actual rendering would happen here with a proper PDF renderer
      images.push({
        pageNumber: pageNum,
        imageBuffer: Buffer.from(''), // Empty buffer as placeholder
        contextBefore: pageText.substring(0, 500),
        contextAfter: pageText.substring(pageText.length - 500),
        nearbyText: pageText.substring(0, 1000),
        imageType: 'page_with_diagram',
        topics,
        caption: `Page ${pageNum} - Contains diagrams or important content`
      })
    }
    
    console.log(`[PDF_RENDERER] Identified ${images.length} pages with important content`)
    
    // Return metadata about important pages
    // The actual rendering would need to be done by a different service
    // or using a library that can render PDFs to images
    return images
  } catch (error) {
    console.error('[PDF_RENDERER] Error processing PDF:', error)
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
