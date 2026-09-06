# 25th Chapter — Continuous Live Broadcast

The primary experience is now a continuous, AI-generated HLS broadcast. The
application composes Portals capabilities rather than advancing a story in the
browser:

```text
NarrativeEngine -> finished image and optional bounded TTS --authenticated multipart--> queue-broadcast -> HLS
                                                                  -> IndustryMediaPlayer
YouTube/Twitch/app chat -> realtime-fanout -> persisted chat -> existing WebSocket
schedule/operator state -> runtime-core -> BroadcastCoordinator
```

`/watch` is always available. A channel produces ambient, non-canonical material
between scheduled episodes. Three minutes before an episode it stages at least
two canonical slots in the remote streamer without making them eligible for
playout. A slot contains an image and optional audio; image-only slots are
valid when TTS is unavailable. At the scheduled start, it drains the current
ambient slot, releases staged canonical slots sequentially,
and returns to ambient generation after the scheduled end.

The old replay APIs, data, and routes remain available for a future archive
experience, but they are not part of the primary navigation.

## Live broadcast configuration

Install the Portals capabilities from the npm registry; the application does not
use sibling `file:` packages:

- `@portalshq/capability-queue-broadcast` (server only)
- `@portalshq/capability-video-delivery`
- `@portalshq/capability-realtime-fanout`
- `@portalshq/runtime-core`

`BROADCAST_CHANNELS_JSON` is validated during startup and keyed by the existing
application channel ID. Tokens and OAuth credentials are referenced by variable
name, never embedded in the registry:

```json
{
  "your-channel-id": {
    "controlEndpoint": "https://streamer.example.com",
    "queueTokenEnv": "BROADCAST_QUEUE_TOKEN",
    "youtube": {
      "liveChatId": "youtube-live-chat-id",
      "clientIdEnv": "YOUTUBE_CLIENT_ID",
      "clientSecretEnv": "YOUTUBE_CLIENT_SECRET",
      "refreshTokenEnv": "YOUTUBE_REFRESH_TOKEN"
    },
    "twitch": {
      "broadcasterUserId": "123",
      "userId": "456",
      "clientIdEnv": "TWITCH_CLIENT_ID",
      "clientSecretEnv": "TWITCH_CLIENT_SECRET",
      "refreshTokenEnv": "TWITCH_REFRESH_TOKEN"
    }
  }
}
```

Each control endpoint must be unique and must not contain credentials, a query,
or a fragment. It is the Streamer's authenticated FastAPI base URL—typically
`http://localhost:8000` in development—not the public HLS URL on port `8888`.
`GET /v1/stream` on the control endpoint returns that HLS manifest separately.
The legacy `endpoint` field is accepted only for configuration migration.
Production control endpoints and returned playback manifests must use HTTPS.
Set every referenced secret, `SESSION_SECRET`, `GOOGLE_CLOUD_BUCKET` (or
`PUBLIC_BASE_URL` for local archive media), the selected AI provider variables,
and the TTS variables before startup. GCS/object storage remains the canonical archive and
replay store; the streamer does not fetch it for normal playout, so its URL
ingest allowlist does not need the archive host for this application.

The queue bearer token and `QueueBroadcastClient` are constructed only in server
modules. The public playback endpoint returns the token-free HLS descriptor,
delivery health, broadcast state, and real process-local viewer count:

```text
GET /api/channels/:channelId/playback
```

Authenticated operators can inspect, stop, or restart a configured channel:

```text
GET  /api/admin/broadcasts/:channelId
POST /api/admin/broadcasts/:channelId/stop
POST /api/admin/broadcasts/:channelId/restart
```

Desired `running`/`stopped` state and canonical session cursors are persisted in
system settings. A restart creates a new ambient run identity while canonical
work reconciles from persisted delivery segments and deterministic queue keys.
Canonical delivery segments persist individual staged image/audio receipts and
their shared slot key. If the application stops after archival but before a
receipt is saved, recovery downloads that archive into the application process
once and re-uploads only the missing item; the streamer itself never performs
that download.

### Streamer availability gate

Before it creates any image/TTS media, downloads a canonical archive for
recovery, or stages a direct media upload, a running channel requires both
`GET /health` to report `ok: true` and its authenticated `GET /v1/stream`
request to succeed. This validates the control API, queue token, and MediaMTX
readiness without exposing credentials to the browser.

If either probe fails, the channel remains desired `running` but reports
`mode: "waiting_for_streamer"` in its admin and playback status. Its
`broadcast.streamer` object contains only `state`, last-check/last-success/retry
timestamps, and a safe failure reason. It retries after 2, 5, 10, then 30 seconds (capped at 30
seconds); stop, restart, and process shutdown cancel the in-flight wait. A
scheduled or active episode is reported as `preparing` until both probes pass,
then resumes without advancing its canonical cursor while unavailable. This
producer gate is distinct from the public HLS delivery health reported to the
player.

## Direct queue ingestion contract

`massively-social-ebook` and the Streamer are separate services. The ebook
backend holds generated bytes only long enough to send independent authenticated
multipart image, audio, or video uploads through `QueueBroadcastClient`. Each
turn stages its successful items under one slot key, then atomically releases
the slot. The Streamer checks every SHA-256, owns the files in its durable
volume, and processes released items in FIFO order. Adjacent image/audio items
may be composited; image-only turns still play, while the ebook intentionally
discards lone audio after image-generation failure. The queue bearer token,
client, jobs, and endpoint configuration never enter the browser bundle.

Ambient material is staged and released immediately. Canonical material is
archived for replay, staged during pre-roll, then released at the scheduled
start. Image and TTS each receive three bounded attempts; exhausted image work
skips the turn, while exhausted TTS releases the successful image for
`BROADCAST_IMAGE_ONLY_DURATION_SECONDS` (twelve seconds by default).
`TTS_HISTORY_PROMPT` is the server-only Bark speaker preset (default
`Speaker 1 (en)`), not story context. This is intentionally a completed-media protocol, not raw-frame piping:
it preserves durable backpressure, HLS continuity, and remote-process failure
isolation without a shared filesystem.

`BROADCAST_FETCH_TIMEOUT_MS` bounds normal queue control requests. Keep
`BROADCAST_UPLOAD_TIMEOUT_MS` high enough for the largest permitted direct media
on the network path; it defaults to 120 seconds.

The v1 deployment is intentionally single-instance: fan-out and provider
connector leadership are process-local. Horizontal scaling requires an external
fan-out adapter and one elected provider-connector leader.

### Channel IDs

Channel IDs are application keys, queue slot prefixes, and API path parameters.
Use a single URL-path-safe identifier such as `25th-chapter`; do not use a
`nap://` URI as a channel ID. The NAP resolver accepts the bare repository ID.

To migrate an existing `nap://25th-chapter` channel, stop that broadcast, run a
dry run, then apply the migration:

```bash
DOTENV_CONFIG_PATH=.env.local npm run migrate:channel-id -- --from nap://25th-chapter --to 25th-chapter
DOTENV_CONFIG_PATH=.env.local npm run migrate:channel-id -- --from nap://25th-chapter --to 25th-chapter --apply
```

The migration renames FK-backed channel rows, moves broadcast desired-state and
cursor settings, and clears persisted queue receipts. It preserves narrative
and archived media, but intentionally does not mutate the separate Streamer
database; discard any legacy staged slots there before restarting the channel.

## Database migration

Apply `server/migrations/004_live_broadcast.sql`. It adds canonical delivery
segments and stable, deduplicated chat identity/provenance fields while retaining
the compatibility image/audio and username columns.

## RAG Provider Configuration

The RAG (Retrieval-Augmented Generation) provider supports optional embedding generation control:

### useEmbeddings Option

The `RagProvider` constructor accepts a `useEmbeddings` boolean option in the `RagProviderOptions` interface:

```typescript
interface RagProviderOptions {
  sqlite?: SqliteDatabase;
  generateEmbedding?: (query: string) => Promise<number[]>;
  useEmbeddings?: boolean; // When false, skips embedding generation in searchCandidates
}
```

**Behavior:**
- **Default:** `true` - Generates and uses embeddings for vector search (backward compatible)
- **When `false`:** Skips embedding generation, uses only keyword-based search
- **Safe default:** The database `embedding` column is nullable, allowing NULL values when embeddings are not generated

**Use cases:**
- Performance optimization in high-throughput scenarios
- Cost reduction by avoiding embedding API calls
- Testing without embedding services
- Fallback when embedding generation fails

**Example:**
```typescript
const provider = new RagProvider({
  useEmbeddings: false, // Skip embedding generation
  // ... other options
});
```

## Media Player

The application uses an industry-standard media player built on hls.js with advanced analytics capabilities:

- **Format Support**: HLS live streams (`.m3u8`) and MP4 on-demand content
- **Advanced Analytics**: Tracks engagement metrics, watch time, buffer events, quality changes, and completion rates
- **Custom Controls**: Maintains the existing beautiful custom UI while leveraging hls.js's robust streaming engine
- **Error Recovery**: Automatic reconnection with exponential backoff for network issues
- **Performance**: Optimized streaming with adaptive bitrate support
- **Native Fallback**: Uses native HLS support on Safari (hls.js only when needed)

### Analytics Events

The media player tracks the following events via Mixpanel:

- `media_session_start` - Session initialization with channel and media type
- `media_session_end` - Session completion with duration and completion rate
- `media_play` - Playback start events
- `media_pause` - Playback pause events
- `media_buffer_start` - Buffer start events
- `media_buffer_end` - Buffer end events with duration
- `media_quality_change` - Quality level changes
- `media_error` - Error events with error messages
- `media_seek` - Seek events with from/to positions
- `media_complete` - Content completion events

### Player Configuration

The player is configured with industry-standard settings:

- **HLS Configuration**: Low-latency mode enabled, live sync duration count of 3, max playback rate of 1.25x
- **Buffer Management**: Smart buffer handling with automatic recovery
- **Format Detection**: Automatic detection of HLS vs MP4 content
- **Performance**: Web Worker enabled for HLS processing

---

# Previous product specification (archive context)

## Overview

25th Chapter is a social fiction platform designed to transform reading from a solitary activity into a shared narrative experience.

The product combines serialized visual fiction, AI-assisted storytelling, and asynchronous social discovery to create the feeling of experiencing a story alongside thousands of other readers.

The core insight:

> People do not necessarily need real-time interaction to feel socially connected. They want to feel that they are discovering, interpreting, and anticipating a story alongside others.

25th Chapter creates this feeling without requiring synchronized viewing schedules.

---

# Product Thesis

Traditional entertainment is divided:

## Books

Deep immersion, but solitary.

## Television

Shared cultural moments, but passive.

## Social media

Highly social, but fragmented and shallow.

25th Chapter combines:

* narrative immersion
* episodic storytelling
* audience participation
* collective interpretation
* persistent community

The goal is not to add social features to reading.

The goal is to create a new category:

> Shared asynchronous entertainment.

---

# Initial Validation Hypothesis

The first question:

> Will people voluntarily spend 6–8 minutes reading serialized visual fiction on their phone and return for future episodes?

The initial product should validate:

1. Story completion
2. Episode return rate
3. Emotional engagement
4. Social participation
5. Desire for future episodes

Do not optimize for complexity before proving retention.

---

# Launch Format

## On-Demand Episodes

The product uses on-demand episodic reading.

Users:

1. Open the app
2. Immediately begin Episode 1
3. Complete the story
4. Choose to follow for future episodes
5. Return when new episodes release

No scheduled sessions, no synchronization, no waiting.

The experience begins immediately.

Reason:

Early users should not need to coordinate their schedule before product-market fit exists.

The MVP isolates story engagement as the primary metric.

---

# Content Format

## Episode Length

Target:

5–8 minutes per episode.

Reason:

* Low commitment
* Mobile-friendly
* Compatible with daily habits
* Creates episodic anticipation

The product should feel closer to:

* a TV episode
* a serialized comic
* a daily fiction drop

rather than a traditional novel.

---

# Initial Story

## 25th Chapter Universe

Genre:

* mystery
* crime
* science fiction
* investigative drama

Reference feeling:

* The X-Files
* Fringe
* serialized detective fiction

Core setup:

A group of agents, investigators, and government personnel become involved in increasingly complex mysteries involving hidden systems, conspiracies, and unexplained events.

---

# Story Creation Model

Initial episodes should be handcrafted.

Goal:

Establish:

* characters
* world rules
* narrative motifs
* tone
* pacing
* themes

The first three episodes become the foundation context for future AI-assisted generation.

Long-term thesis:

Creators define:

* worlds
* characters
* themes
* constraints

AI assists with:

* expansion
* production
* variation
* continuation

The creator becomes the architect of the world rather than the sole producer of every narrative artifact.

---

# Core Social Features (Coming Soon)

## 1. Story Notes

### Purpose

Create the feeling of discovering annotations in the margins of a beloved book.

Readers see high-quality reactions from other readers at the exact narrative moment where they appear.

Example:

Reader reaches a scene.

A marker appears:

> 247 Story Notes

Opening:

> "I knew Agent Cole was hiding something."

> "This line changes the entire story."

---

## Design Principles

Story Notes must:

* never reveal future information
* never interrupt reading
* enhance emotional moments
* surface only high-signal contributions

Readers can only comment on content they have completed.

---

# 2. Predictions

### Purpose

Turn passive reading into active participation.

Examples:

* Who do you trust?
* What happens next?
* Who is lying?
* What is the hidden motive?

After submitting:

Readers see:

* community predictions
* their prediction compared with others
* eventual accuracy

Predictions create anticipation between episodes.

---

# 3. Episode Discussions

### Purpose

Create spoiler-safe community.

Each episode has a persistent discussion space.

Rules:

* Episode discussion unlocks only after completion
* Users cannot access future episode discussions
* Discussions remain available permanently

This creates a community without requiring everyone to read simultaneously.

---

# Future Social Features

## Reader Investigation System

Deferred until retention exists.

Readers collaboratively:

* identify clues
* create theories
* connect story elements
* investigate mysteries

Potential AI layer:

Generate community theories from reader observations.

Example:

> Most readers believe the red key is connected to Agent Hayes because...

This creates a meta-game around narrative discovery.

---

# Features Deferred

## Real-Time Chat

Removed from MVP.

Reason:

* requires synchronized audiences
* creates spoiler risk
* distracts from narrative immersion
* adds moderation complexity
* makes it impossible to isolate story engagement metrics

The MVP measures:
* Episode completion
* Replay rate
* Episode 2 opens
* Shares
* Followers

These determine product-market fit without chat variables.

Future use:

Live premieres, special events, and season finales.

---

# Product Principles

## Story First

Every feature must improve the narrative experience.

## No Spoilers

Social interaction must preserve discovery.

## Async Before Live

Build community before requiring synchronization.

## High Signal Over High Volume

Curated contributions are more valuable than unlimited conversation.

## Emotion Over Technology

The product should sell the feeling, not the underlying AI.

---

# Marketing Position

Do not initially market:

"AI-generated stories."

Market:

> A new kind of reading experience.

Core message:

> Reading doesn't have to be lonely anymore.

Alternative:

> Imagine opening a mystery novel and seeing what thousands of readers thought at the exact same moment you reached it.

---

# Launch Campaign

## Phase 1: Curiosity

Share the idea.

Question:

> What if books had the feeling of a movie theater?

---

## Phase 2: Feature Demonstration

Show:

* Story Notes
* Predictions
* Episode Discussions

Demonstrate the experience.

---

## Phase 3: Episode Launch

Release:

* Episode 1
* app access
* follow mechanism for future episodes

Primary metrics:

* completion rate
* episode return rate
* Story Note participation
* prediction participation
* organic sharing

---

# Long-Term Vision

25th Chapter evolves into a platform for programmable entertainment.

Creators define:

* worlds
* characters
* narrative rules

Audiences participate through:

* reading
* prediction
* interpretation
* discovery

AI enables persistent, evolving fictional universes.

The future entertainment model is not only watching stories.

It is inhabiting worlds together.
