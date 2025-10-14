// Wrapper for pdfjs-dist to work in Node.js environment
// This avoids the "DOMMatrix is not defined" error

let pdfjsLib: any;

// Use try-catch to handle different module formats
try {
  // Try CommonJS format first
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
} catch (e) {
  try {
    // Fallback to the module path
    pdfjsLib = require('pdfjs-dist/build/pdf.js');
  } catch (e2) {
    // Last resort - use the standard import
    pdfjsLib = require('pdfjs-dist');
  }
}

// Disable the worker to avoid issues in Node.js
pdfjsLib.GlobalWorkerOptions.workerSrc = false;
pdfjsLib.GlobalWorkerOptions.isEvalSupported = false;

// Export the configured library
export const getDocument = pdfjsLib.getDocument;
export const GlobalWorkerOptions = pdfjsLib.GlobalWorkerOptions;
export const version = pdfjsLib.version;

// Re-export types from the main package
export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
