export async function extractTextWithOCR(pdfBuffer: Buffer): Promise<string> {
  console.log('[OCR] Starting OCR extraction...')
  
  try {
    // For now, we'll use a simpler approach that works with Next.js
    // We'll use pdf.js to extract any embedded text first
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf')
    
    // Configure PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
    
    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
    })
    const pdfDoc = await loadingTask.promise
    const numPages = pdfDoc.numPages
    
    console.log(`[OCR] PDF has ${numPages} pages`)
    
    // Try to extract text content from each page
    const pageTexts: string[] = []
    
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      console.log(`[OCR] Extracting text from page ${pageNum}/${numPages}...`)
      
      try {
        const page = await pdfDoc.getPage(pageNum)
        const textContent = await page.getTextContent()
        
        // Extract text from the page
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ')
        
        if (pageText.trim().length > 0) {
          pageTexts.push(pageText)
          console.log(`[OCR] Page ${pageNum} extracted ${pageText.length} characters using PDF.js`)
        } else {
          // If no text found, we would need OCR but that requires canvas
          // For now, we'll log this and continue
          console.log(`[OCR] Page ${pageNum} appears to be an image, OCR would be needed`)
          pageTexts.push('[Page contains image - OCR required]')
        }
      } catch (pageError) {
        console.error(`[OCR] Error processing page ${pageNum}:`, pageError)
        pageTexts.push('') // Add empty string for failed pages
      }
    }
    
    const fullText = pageTexts.join('\n\f\n') // Join with form feed character
    console.log(`[OCR] Total extracted text length: ${fullText.length} characters`)
    
    return fullText
  } catch (error) {
    console.error('[OCR] Error during text extraction:', error)
    throw error
  }
}

export function shouldUseOCR(extractedText: string, pageCount: number): boolean {
  // Calculate average characters per page
  const avgCharsPerPage = extractedText.length / pageCount
  
  // If average is less than 100 characters per page, likely needs OCR
  const needsOCR = avgCharsPerPage < 100
  
  console.log(`[OCR] Text analysis: ${extractedText.length} chars across ${pageCount} pages = ${avgCharsPerPage.toFixed(1)} chars/page`)
  console.log(`[OCR] Needs OCR: ${needsOCR}`)
  
  return needsOCR
}
