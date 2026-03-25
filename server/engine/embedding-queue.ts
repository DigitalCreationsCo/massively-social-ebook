import { generateBlockEmbedding } from "../engine/embedding";
import { storage } from "../storage";

async function processWithRetry(fn: () => Promise<void>, retries = 3): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}

export function enqueueEmbeddingTask(blockId: number, content: string, title?: string | null): void {
  setImmediate(async () => {
    try {
      await processWithRetry(async () => {
        const embedding = await generateBlockEmbedding(content, title);
        await storage.setBlockEmbedding(blockId, embedding);
      });
      console.log(`[EmbeddingQueue] Block ${blockId} embedded successfully`);
    } catch (err) {
      console.error(`[EmbeddingQueue] Failed to embed block ${blockId} after retries:`, err);
    }
  });
}
