declare module 'pdfjs-dist' {
  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
  }

  export interface PDFPageProxy {
    getViewport(params: { scale: number }): PDFPageViewport;
    render(params: {
      canvasContext: CanvasRenderingContext2D;
      viewport: PDFPageViewport;
    }): { promise: Promise<void> };
    getOperatorList(): Promise<{
      fnArray: number[];
      argsArray: any[];
    }>;
  }

  export interface PDFPageViewport {
    width: number;
    height: number;
  }

  export const GlobalWorkerOptions: {
    workerSrc: string | boolean;
  };

  export function getDocument(params: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    disableFontFace?: boolean;
  }): {
    promise: Promise<PDFDocumentProxy>;
  };
}
