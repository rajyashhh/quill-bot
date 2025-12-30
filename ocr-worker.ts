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

  // Get total pages first
  const { default: pdfParse } = await import("pdf-parse-fork");
  const parsed = await pdfParse(pdfBuffer);
  const totalPages = parsed.numpages;

  await db.file.update({
    where: { id: fileId },
    data: { totalPages: totalPages }
  });

  console.log(`[OCR-WORKER] Document has ${totalPages} pages. Processing in batches...`);

  let fullText = "";
  let pageTexts: Array<{ page: number; text: string; quality: string }> = [];

  const BATCH_SIZE = 10;

  for (let batchStart = 1; batchStart <= totalPages; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, totalPages);
    console.log(`[OCR-WORKER] Processing batch: pages ${batchStart} to ${batchEnd}`);

    const convert = fromBuffer(pdfBuffer, {
      density: 300,
      format: "png",
      saveFilename: "page",
      savePath: tempDir,
      width: 2400,
      height: 3200,
      quality: 100,
    });

    // Convert only this batch of pages
    // pdf2pic bulk takes explicit page numbers or -1 for all.
    // We need to convert specific pages. 
    // converting one by one inside the batch loop is safer for memory

    for (let i = batchStart; i <= batchEnd; i++) {
      try {
        const pageImage = await convert(i, { responseType: "image" });
        const imagePath = pageImage.path;

        // Run Vision OCR
        const [result] = await visionClient.textDetection(imagePath);
        const pageText = result.fullTextAnnotation?.text?.trim() || "";

        const hasLetters = /[a-zA-Z]/.test(pageText);
        const specialCharRatio =
          (pageText.match(/[^a-zA-Z0-9\s.,;:!?()\-]/g) || []).length /
          Math.max(pageText.length, 1);

        if (hasLetters && specialCharRatio < 0.5) {
          fullText += `\n\n--- Page ${i} ---\n${pageText}`;
          pageTexts.push({ page: i, text: pageText, quality: "good" });
          console.log(`[OCR-WORKER] ✓ Page ${i}: ${pageText.length} chars (good quality)`);
        } else {
          console.log(`[OCR-WORKER] ⚠ Page ${i}: Low quality OCR (${specialCharRatio.toFixed(2)} ratio)`);
          fullText += `\n\n--- Page ${i} ---\n[Page content could not be reliably extracted]`;
          pageTexts.push({ page: i, text: "", quality: "poor" });
        }

        // Clean up image immediately
        fs.unlinkSync(imagePath);

      } catch (error) {
        console.error(`[OCR-WORKER] Error on page ${i}:`, error);
        fullText += `\n\n--- Page ${i} ---\n[OCR error]`;
      }

      const progress = Math.round((i / totalPages) * 100);
      // Update DB less frequently to avoid lock contention
      if (i % 5 === 0 || i === totalPages) {
        await db.file.update({
          where: { id: fileId },
          data: {
            ocrProgress: progress,
            processedPages: i
          }
        });
      }
    }
  }

  console.log("[OCR-WORKER] ✅ OCR complete.");

  const goodPages = pageTexts.filter(p => p.quality === "good").length;
  console.log(`[OCR-WORKER] Quality: ${goodPages}/${totalPages} pages readable`);

  const outputPath = pdfPath.replace(/\.pdf$/, "_ocr.txt");
  fs.writeFileSync(outputPath, fullText, "utf8");

  console.log(`[OCR-WORKER] 📝 Saved text to ${outputPath}`);

  // Cleanup temp dir if empty
  try { fs.rmdirSync(tempDir); } catch (e) { }
  return fullText;
}

import { ChapterExtractor } from "./src/lib/chapter-extractor.ts";

async function reindexOCR(fileId: string, ocrText: string) {
  console.log(`[OCR-WORKER] Starting reindex for ${fileId}`);

  const hasLetters = /[a-zA-Z]{3,}/.test(ocrText);
  const textLength = ocrText.replace(/\s/g, "").length;

  if (!hasLetters || textLength < 100) {
    console.log("[OCR-WORKER] ⚠️ OCR text quality too low, skipping indexing");
    await db.file.update({
      where: { id: fileId },
      data: {
        ocrText: ocrText + "\n\n[Warning: OCR quality was poor.]",
        uploadStatus: "SUCCESS",
        ocrCompletedAt: new Date(),
        ocrProcessed: true,
        ocrProgress: 100
      }
    });
    return;
  }

  // 1. Extract Chapters using the new method
  console.log('[OCR-WORKER] extracting chapters from OCR text...');
  const extractor = new ChapterExtractor();
  const { chapters } = await extractor.extractChaptersFromText(ocrText);
  console.log(`[OCR-WORKER] Found ${chapters.length} chapters.`);

  // 2. Save Chapters to DB
  // First clean up old chapters if any
  await db.chapter.deleteMany({ where: { fileId: fileId } });

  for (const chapter of chapters) {
    const content = extractor.extractChapterContent(ocrText, chapter);
    const topics = extractor.identifyTopics(content);

    await db.chapter.create({
      data: {
        fileId: fileId,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        content: content,
        startPage: chapter.startPage,
        endPage: chapter.endPage,
        topics: { create: topics.map((t: any) => ({ ...t })) },
      }
    });
  }

  // 3. Indexing (Pinecone) using Chapter-Aware chunks
  // We mimic the logic from ChapterAwarePineconeIndexer but adapted for text
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200
  });

  const embeddings = new OpenAIEmbeddings({
    openAIApiKey: process.env.OPENAI_API_KEY
  });

  const pinecone = await getPineconeClient();
  const index = pinecone.Index("quill");

  let vectorsToUpsert = [];

  if (chapters.length > 0) {
    console.log('[OCR-WORKER] Indexing with chapter metadata...');

    // Indexing logic per chapter
    for (const chapter of chapters) {
      const chapterContent = extractor.extractChapterContent(ocrText, chapter);
      // Just chunk the whole chapter content for simplicity in this worker script
      // (We could do topics but let's match the core level of granularity first)

      const chunks = await splitter.splitText(chapterContent);
      if (chunks.length === 0) continue;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = await embeddings.embedQuery(chunk);

        vectorsToUpsert.push({
          id: `${fileId}-ch${chapter.chapterNumber}-chunk${i}`,
          values: embedding,
          metadata: {
            text: chunk,
            fileId: fileId,
            chapterNumber: chapter.chapterNumber,
            chapterTitle: chapter.title,
            pageNumber: chapter.startPage,
            source: "OCR"
          }
        });
      }
    }
  } else {
    console.log('[OCR-WORKER] No chapters. Fallback to flat indexing.');
    const chunks = await splitter.splitText(ocrText);
    const vectors = await embeddings.embedDocuments(chunks);

    vectorsToUpsert = vectors.map((v, i) => ({
      id: `${fileId}-ocr-${i}`,
      values: v,
      metadata: {
        text: chunks[i],
        source: "OCR",
        chunkIndex: i,
        fileId: fileId,
        pageNumber: chunks[i].match(/--- Page (\d+) ---/)?.[1] || "unknown"
      }
    }));
  }

  const batchSize = 100;
  for (let i = 0; i < vectorsToUpsert.length; i += batchSize) {
    const batch = vectorsToUpsert.slice(i, i + batchSize);
    await index.namespace(fileId).upsert(batch);
    console.log(`[OCR-WORKER] Upserted batch ${Math.floor(i / batchSize) + 1}`);
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

  console.log(`[OCR-WORKER] ✅ Reindexed ${vectorsToUpsert.length} OCR vectors for ${fileId}`);
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
