import fs from "fs";
import path from "path";
import { config } from "dotenv";

config({ path: path.resolve("../../.env") });
config({ path: path.resolve("../../.env.local") });

const API_URL = process.env.VITE_TTS_API_URL || "";
const TEXT = process.argv[ 2 ] || "[5 Cars drive by on a single-lane road. The sound of each passing car grows as it comes closer, and decreases as it moves away.]";
const OUT_DIR = path.resolve("../../scripts/test/output");
const TTS_TOKEN = process.env.HF_TOKEN;

interface TtsJobResponse {
  event_id: string;
}

interface GradioFile {
  path: string;
  url?: string;
  size?: number | null;
  orig_name?: string;
}

function parseSSE(chunk: string): GradioFile[] {
  const files: GradioFile[] = [];
  for (const line of chunk.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      // Gradio SSE wraps results in { status, data: [...] }
      const items = parsed?.data ?? parsed;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item?.path) files.push(item as GradioFile);
        }
      } else if (items?.path) {
        files.push(items as GradioFile);
      }
    } catch { /* skip unparseable */ }
  }
  return files;
}

async function main() {
  if (!API_URL) {
    console.error("ERROR: VITE_TTS_API_URL is not set in .env or .env.local");
    process.exit(1);
  }

  console.log(`TTS endpoint: ${API_URL}`);
  console.log(`Text (${TEXT.length} chars): "${TEXT}"`);
  console.log();

  // 1. Create job
  console.log("Creating TTS job...");
  const t0 = Date.now();
  const createRes = await fetch(`${API_URL}/v2/gen_tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + TTS_TOKEN
    },
    body: JSON.stringify({ text: TEXT }),
  });
  if (!createRes.ok) {
    console.error(`Create failed: ${createRes.status} ${createRes.statusText}`);
    const body = await createRes.text();
    if (body) console.error("Response:", body);
    process.exit(1);
  }
  const { event_id }: TtsJobResponse = await createRes.json();
  const t1 = Date.now();
  console.log(`  event id: ${event_id} (${t1 - t0}ms)`);

  // 2. Poll — endpoint returns SSE stream
  console.log("Polling (SSE)...");
  const pollRes = await fetch(`${API_URL}/gen_tts/${event_id}`, {
    headers: { "Authorization": "Bearer " + TTS_TOKEN },
  });
  if (!pollRes.ok) {
    console.error(`Poll failed: ${pollRes.status} ${pollRes.statusText}`);
    process.exit(1);
  }

  const reader = pollRes.body?.getReader();
  if (!reader) {
    console.error("No response body");
    process.exit(1);
  }

  const decoder = new TextDecoder();
  let buf = "";

  // Read the entire SSE stream first, then parse
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
  }

  const files = parseSSE(buf);

  if (files.length === 0) {
    console.error("No audio results found in SSE response");
    console.error("Raw response:", buf.slice(0, 500));
    process.exit(1);
  }

  const audio = files[ 0 ];
  const audioUrl = audio.url || audio.path;
  const t2 = Date.now();
  console.log(`  completed after ${((t2 - t1) / 1000).toFixed(1)}s`);
  console.log(`  audio URL: ${audioUrl}`);

  // 3. Download
  console.log("Downloading audio...");
  const audioRes = await fetch(audioUrl, {
    headers: { "Authorization": "Bearer " + TTS_TOKEN },
  });
  if (!audioRes.ok) {
    console.error(`Download failed: ${audioRes.status} ${audioRes.statusText}`);
    process.exit(1);
  }
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const t3 = Date.now();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `tts-${timestamp}.wav`;
  const filepath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filepath, audioBuffer);

  console.log(`  saved: ${filepath}`);
  console.log(`  size:  ${(audioBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`  dl:    ${t3 - t2}ms`);
  console.log(`  total: ${((t3 - t0) / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
