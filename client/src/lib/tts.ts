interface TtsResponse {
  audioUrl: string;
}

export async function textToSpeech(text: string): Promise<string | null> {
  try {
    const res = await fetch("/api/tts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[TTS] Failed: ${res.status} ${res.statusText}`);
      const body = await res.text().catch(() => "");
      if (body) console.error("[TTS] Response:", body);
      return null;
    }
    let data: TtsResponse;
    try {
      data = await res.json();
    } catch {
      console.error("[TTS] Invalid JSON response from server");
      return null;
    }
    if (!data?.audioUrl) {
      console.error("[TTS] Server response missing audioUrl");
      return null;
    }
    return data.audioUrl;
  } catch (err) {
    console.error("[TTS] Error:", err);
    return null;
  }
}

export async function fetchAudioBuffer(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[TTS] Fetch audio failed: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.arrayBuffer();
  } catch (err) {
    console.error("[TTS] Fetch audio error:", err);
    return null;
  }
}
