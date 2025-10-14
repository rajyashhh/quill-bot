export async function extractTextWithOCR(pdfBuffer: Buffer): Promise<string> {
  console.log('[OCR] Starting OCR extraction...')
  
  try {
    // For now, return empty string as OCR requires external services
    // In production, you would integrate with services like:
    // - Google Cloud Vision API
    // - AWS Textract
    // - Azure Computer Vision
    // - Tesseract.js (client-side)
    console.log('[OCR] OCR not implemented - returning empty string')
    console.log('[OCR] To enable OCR, integrate with cloud services or use Tesseract.js')
    return ''
  } catch (error) {
    console.error('[OCR] Error during text extraction:', error)
    return ''
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
