const MAX_DIALOGUE = 2;

type TrackType = "ambient" | "dialogue";

interface AudioChannel {
  source: AudioBufferSourceNode;
  gain: GainNode;
  id: number;
  type: TrackType;
}

function createAudioManager() {
  let ctx: AudioContext | null = null;
  const channels = new Map<number, AudioChannel>();
  let nextId = 0;

  function getContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
    }
    // Best-effort resume for mobile browsers that start suspended.
    // If the browser requires a user gesture, this silently fails and
    // the audio will play once the user interacts with the page again.
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  async function ensureResumed(): Promise<boolean> {
    const c = getContext();
    if (c.state === "suspended") {
      try {
        await c.resume();
      } catch {
        console.warn("[AudioManager] Could not resume AudioContext");
        return false;
      }
    }
    return true;
  }

  function remove(id: number) {
    const ch = channels.get(id);
    if (!ch) return;
    try {
      ch.source.stop();
    } catch {}
    ch.source.disconnect();
    ch.gain.disconnect();
    channels.delete(id);
  }

  function getDialogueCount(): number {
    let count = 0;
    for (const ch of channels.values()) {
      if (ch.type === "dialogue") count++;
    }
    return count;
  }

  function hasAmbient(): boolean {
    for (const ch of channels.values()) {
      if (ch.type === "ambient") return true;
    }
    return false;
  }

  function play(buffer: AudioBuffer, type: TrackType) {
    if (type === "dialogue") {
      const dCount = getDialogueCount();
      if (dCount >= MAX_DIALOGUE) {
        let culled: AudioChannel | null = null;
        for (const ch of channels.values()) {
          if (ch.type === "dialogue") {
            culled = ch;
            break;
          }
        }
        if (culled) remove(culled.id);
      }
    }

    if (type === "ambient" && hasAmbient()) {
      for (const ch of channels.values()) {
        if (ch.type === "ambient") remove(ch.id);
      }
    }

    const c = getContext();
    const source = c.createBufferSource();
    source.buffer = buffer;

    const gain = c.createGain();
    gain.gain.value = type === "ambient" ? 0.3 : 1.0;

    source.connect(gain);
    gain.connect(c.destination);

    const id = nextId++;
    const channel: AudioChannel = { source, gain, id, type };

    source.onended = () => {
      if (channels.has(id)) remove(id);
    };

    source.start();
    channels.set(id, channel);
  }

  function stopDialogue() {
    for (const [id, ch] of channels) {
      if (ch.type === "dialogue") remove(id);
    }
    if (channels.size === 0) {
      getContext().close();
      ctx = null;
    }
  }

  function stopAll() {
    for (const id of channels.keys()) remove(id);
  }

  function isPlaying(): boolean {
    return channels.size > 0;
  }

  return { play, stopDialogue, stopAll, isPlaying, ensureResumed, getContext };
}

export const audioManager = createAudioManager();
