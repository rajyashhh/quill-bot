import fs from "fs";
import path from "path";
import { fromBuffer } from "pdf2pic";
import vision from "@google-cloud/vision";

import { db } from "./src/db/index.ts";
import { getPineconeClient } from "./src/lib/pinecone.ts";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

console.log('[OCR-WORKER] Starting OCR worker...');
console.log('[OCR-WORKER] Checking for credentials...');
console.log('[OCR-WORKER] GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
// Initialize Google Cloud Vision Client with credentials
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './credentials.json'
});

async function extractTextWithOCR(pdfPath: string, fileId: string): Promise<string> {
  console.log(`[OCR-WORKER] 🔍 Starting OCR for ${pdfPath}`);

  await db.file.update({
    where: { id: fileId },
    data: {
      uploadStatus: "PROCESSING",
      ocrStartedAt: new Date(),
      usedOCR: true,
      isScanned: true
    }
  });

  const pdfBuffer = fs.readFileSync(pdfPath);

  const tempDir = path.resolve(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const convert = fromBuffer(pdfBuffer, {
    density: 300,
    format: "png",
    saveFilename: "page",
    savePath: tempDir,
    width: 2400,
    height: 3200,
    quality: 100,
  });

  const pages = await convert.bulk(-1);
  console.log(`[OCR-WORKER] Found ${pages.length} pages.`);

  await db.file.update({
    where: { id: fileId },
    data: { totalPages: pages.length }
  });

  let fullText = "";
  let pageTexts: Array<{ page: number; text: string; quality: string }> = [];

  for (const [i, page] of pages.entries()) {
    console.log(`[OCR-WORKER] Processing page ${i + 1}/${pages.length}`);

    try {
      const [result] = await visionClient.textDetection(page.path);
      const pageText = result.fullTextAnnotation?.text?.trim() || "";

      const hasLetters = /[a-zA-Z]/.test(pageText);
      const specialCharRatio =
        (pageText.match(/[^a-zA-Z0-9\s.,;:!?()\-]/g) || []).length /
        Math.max(pageText.length, 1);

      if (hasLetters && specialCharRatio < 0.5) {
        fullText += `\n\n--- Page ${i + 1} ---\n${pageText}`;
        pageTexts.push({ page: i + 1, text: pageText, quality: "good" });

        console.log(
          `[OCR-WORKER] ✓ Page ${i + 1}: ${pageText.length} chars (good quality)`
        );
      } else {
        console.log(
          `[OCR-WORKER] ⚠ Page ${i + 1}: Low quality OCR (${specialCharRatio.toFixed(2)} ratio)`
        );

        fullText += `\n\n--- Page ${i + 1} ---\n[Page content could not be reliably extracted]`;
        pageTexts.push({ page: i + 1, text: "", quality: "poor" });
      }
    } catch (error) {
      console.error(`[OCR-WORKER] Error on page ${i + 1}:`, error);
      fullText += `\n\n--- Page ${i + 1} ---\n[OCR error]`;
    }

    const progress = Math.round(((i + 1) / pages.length) * 100);
    await db.file.update({
      where: { id: fileId },
      data: {
        ocrProgress: progress,
        processedPages: i + 1
      }
    });
  }

  console.log("[OCR-WORKER] ✅ OCR complete.");

  const goodPages = pageTexts.filter(p => p.quality === "good").length;
  console.log(`[OCR-WORKER] Quality: ${goodPages}/${pages.length} pages readable`);

  const outputPath = pdfPath.replace(/\.pdf$/, "_ocr.txt");
  fs.writeFileSync(outputPath, fullText, "utf8");

  console.log(`[OCR-WORKER] 📝 Saved text to ${outputPath}`);

  fs.rmSync(tempDir, { recursive: true, force: true });
  return fullText;
}

async function reindexOCR(fileId: string, ocrText: string) {
  console.log(`[OCR-WORKER] Starting reindex for ${fileId}`);

  const hasLetters = /[a-zA-Z]{3,}/.test(ocrText);
  const textLength = ocrText.replace(/\s/g, "").length;

  if (!hasLetters || textLength < 100) {
    console.log("[OCR-WORKER] ⚠️ OCR text quality too low, skipping indexing");

    await db.file.update({
      where: { id: fileId },
      data: {
        ocrText:
          ocrText +
          "\n\n[Warning: OCR quality was poor. The document may be too complex for accurate extraction.]",
        uploadStatus: "SUCCESS",
        ocrCompletedAt: new Date(),
        ocrProcessed: true,
        ocrProgress: 100
      }
    });

    return;
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200
  });

  const chunks = await splitter.splitText(ocrText);
  console.log(`[OCR-WORKER] Split into ${chunks.length} chunks`);

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY
  });

  const vectors = await embeddings.embedDocuments(chunks);
  console.log(`[OCR-WORKER] Generated ${vectors.length} embeddings`);

  const pinecone = await getPineconeClient();
  const index = pinecone.Index("quill");

  const vectorsToUpsert = vectors.map((v, i) => ({
    id: `${fileId}-ocr-${i}`,
    values: v,
    metadata: {
      text: chunks[i],
      source: "OCR",
      chunkIndex: i,
      fileId: fileId,
      pageNumber:
        chunks[i].match(/--- Page (\d+) ---/)?.[1] || "unknown"
    }
  }));

  const batchSize = 100;

  for (let i = 0; i < vectorsToUpsert.length; i += batchSize) {
    const batch = vectorsToUpsert.slice(i, i + batchSize);
    await index.namespace(fileId).upsert(batch);

    console.log(
      `[OCR-WORKER] Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
        vectorsToUpsert.length / batchSize
      )}`
    );
  }

  await db.file.update({
    where: { id: fileId },
    data: {
      ocrText,
      uploadStatus: "SUCCESS",
      ocrCompletedAt: new Date(),
      ocrProcessed: true,
      ocrProgress: 100
    }
  });

  console.log(`[OCR-WORKER] ✅ Reindexed ${vectors.length} OCR vectors for ${fileId}`);
}

const pdfPath = process.argv[2];
const fileId = process.argv[3];

if (!pdfPath || !fileId) {
  console.error("[OCR-WORKER] ❌ Missing PDF path or fileId");
  process.exit(1);
}

(async () => {
  try {
    const text = await extractTextWithOCR(pdfPath, fileId);
    await reindexOCR(fileId, text);

    console.log("[OCR-WORKER] 🎉 All done!");
    process.exit(0);
  } catch (error) {
    console.error("[OCR-WORKER] ❌ Fatal error:", error);

    try {
      await db.file.update({
        where: { id: fileId },
        data: {
          uploadStatus: "FAILED",
          ocrProcessed: false
        }
      });
    } catch (dbError) {
      console.error("[OCR-WORKER] ❌ Could not update file status:", dbError);
    }

    process.exit(1);
  }
})();
