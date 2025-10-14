declare module 'pdf-parse-fork' {
  interface PDFData {
    numpages: number
    numrender: number
    info: any
    metadata: any
    text: string
    version: string
  }

  function pdfParse(
    dataBuffer: Buffer,
    options?: {
      pagerender?: (pageData: any) => string
      max?: number
      version?: string
    }
  ): Promise<PDFData>

  export default pdfParse
}
