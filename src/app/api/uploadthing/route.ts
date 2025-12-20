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
});