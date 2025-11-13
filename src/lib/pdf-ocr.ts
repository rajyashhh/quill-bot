import path from "path";
import { spawn } from "child_process";

/**
 * ✅ Launches OCR in a separate Node.js process
 * so that Next.js never directly imports heavy libraries like Tesseract or pdf2pic.
 *
 * @param pdfPath - Absolute path to the local PDF file to OCR
 * @param fileId - The database ID of the uploaded file (for syncing OCR output)
 */
export async function runOCRInWorker(pdfPath: string, fileId: string) {
  const workerPath = path.resolve(process.cwd(), "ocr-worker.ts");
  console.log(`[OCR] 🧠 Spawning external OCR worker for: ${pdfPath}`);

  // Spawn a standalone Node process using ts-node
  const child = spawn("npx", ["ts-node", "--esm", workerPath, pdfPath, fileId], {
    stdio: "inherit",
  });

  child.on("close", (code) => {
    console.log(`[OCR] ✅ Worker exited with code ${code}`);
  });

  child.on("error", (err) => {
    console.error("[OCR] ❌ Worker process failed:", err);
  });
}

/**
 * ✅ Lightweight helper for deciding when OCR should be used
 */
export function shouldUseOCR(extractedText: string, pageCount: number): boolean {
  const avgCharsPerPage = extractedText.length / pageCount;
  const needsOCR = avgCharsPerPage < 100;

  console.log(
    `[OCR] Text analysis: ${extractedText.length} chars across ${pageCount} pages = ${avgCharsPerPage.toFixed(
      1
    )} chars/page`
  );
  console.log(`[OCR] Needs OCR: ${needsOCR}`);
  return needsOCR;
}