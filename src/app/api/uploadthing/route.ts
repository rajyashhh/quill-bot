import fs from "fs";
import path from "path";
import https from "https";
import { createRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";
import { runOCRInWorker } from "@/lib/pdf-ocr";

async function downloadFile(url: string, dest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on("finish", () => {
        file.close();
        console.log(`[UPLOADTHING] ✅ File downloaded to ${dest}`);
        resolve(dest);
      });
    }).on("error", (err) => reject(err));
  });
}

export const { GET, POST } = createRouteHandler({
  router: ourFileRouter,
  onUploadComplete: async ({ file }) => {
    if (file.type === "application/pdf") {
      const tempDir = path.resolve(process.cwd(), "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const pdfPath = path.join(tempDir, file.name.replace(/\s+/g, "_"));
      const fileUrl = file.ufsUrl || file.url;
      await downloadFile(fileUrl, pdfPath);
      runOCRInWorker(pdfPath);
    } else {
      console.log("[UPLOADTHING] Skipping non-PDF file.");
    }
  },
});