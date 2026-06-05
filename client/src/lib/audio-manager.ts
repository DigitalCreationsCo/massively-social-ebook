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

  /**
   * Returns the AudioContext, creating it if needed.
   * Does NOT attempt resume — use ensureResumed() before play().
   */
  function getContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
    }
    return ctx;
  }

  /**
   * Ensures the AudioContext is in a "running" state.
   * Browsers start contexts as "suspended" (autoplay policy).
   * A user gesture (click/tap) is required for the first resume.
   * Returns false if the context could not be resumed.
   */
  async function ensureResumed(): Promise<boolean> {
    const c = getContext();
    const state = c.state;
    if (state === "running") return true;

    if (state === "suspended") {
      try {
        await c.resume();
        console.log("[AudioManager] AudioContext resumed successfully");
        return true;
      } catch (err) {
        console.warn(
          "[AudioManager] Could not resume AudioContext (state=suspended) — " +
            "browser requires a user gesture (click/tap) before audio can play.",
          err,
        );
        return false;
      }
    }

    // "closed" state — need to create a new context
    console.warn("[AudioManager] AudioContext is in '" + state + "' state, creating a new one");
    ctx = new AudioContext();
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

  async function play(buffer: AudioBuffer, type: TrackType): Promise<boolean> {
    // Ensure AudioContext is running before attempting playback.
    // Browsers block audio until a user gesture; this returns false
    // if the context could not be resumed (e.g. no user gesture yet).
    const resumed = await ensureResumed();
    if (!resumed) {
      console.warn(
        "[AudioManager] Cannot play — AudioContext could not be resumed. " +
          "A user interaction (click/tap) is required first.",
      );
      return false;
    }

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
    // Ambient tracks loop continuously (~20-30s generated audio repeated)
    source.loop = type === "ambient";

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
    return true;
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
