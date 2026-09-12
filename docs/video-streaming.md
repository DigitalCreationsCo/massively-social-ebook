# Video Streaming Implementation

This document describes the video streaming capability added to the massively-social-ebook project for both ambient mode and session mode broadcast operations.

## Overview

The video streaming feature enables generation and playback of video content with embedded audio as an alternative to the existing image + TTS (text-to-speech) pipeline. Videos are submitted to the queue broadcast system and streamed in the app client, providing a more immersive experience for story content.

## Architecture

### Components

1. **Video Service** (`server/media/video-service.ts`)
   - Core video generation interface
   - Mock video generation for testing (static files and URLs)
   - Video archival and queue upload asset conversion
   - Video buffer validation

2. **Media Slots** (`server/broadcast/media-slots.ts`)
   - Extended to support video assets in `PreparedAmbientTurn` and `PreparedBroadcastSlot`
   - Video generation integrated into `generateTurnMedia` pipeline
   - Video-aware slot creation for queue broadcast

3. **Coordinator** (`server/broadcast/coordinator.ts`)
   - Environment-based video generation configuration
   - Video generation for both ambient and session modes
   - Queue broadcast integration

### Data Flow

```
Text/Reference → Video Generation → Video Buffer → Queue Upload Asset → Streamer Queue → Client Playback
```

## Configuration

### Environment Variables

Enable video streaming by setting the following environment variables:

```bash
# Enable video generation (default: false)
BROADCAST_USE_VIDEO=true

# Video source for mock generation
BROADCAST_VIDEO_SOURCE=https://test.spotme.com/sample-video.mp4
BROADCAST_VIDEO_SOURCE_TYPE=url  # or "static" for local files
BROADCAST_VIDEO_MIME_TYPE=video/mp4
```

### Database Migration

A database migration adds video support to the blocks table:

```sql
ALTER TABLE "blocks" ADD COLUMN IF NOT EXISTS "video_url" text;
CREATE INDEX IF NOT EXISTS "idx_blocks_video_url" ON "blocks" ("video_url") WHERE "video_url" IS NOT NULL;
```

Run the migration:
```bash
# Apply the migration
npm run migrate
```

## Usage

### Testing with Mock Videos

For testing, use the mock video generation with static files or URLs:

```typescript
import { generateMockVideo, type VideoSourceConfig } from './media/video-service';

// URL-based mock video
const urlConfig: VideoSourceConfig = {
  type: 'url',
  source: 'https://test.spotme.com/sample-video.mp4',
  mimeType: 'video/mp4'
};

const videoBuffer = await generateMockVideo(urlConfig, {
  targetDurationSeconds: 15,
  aspectRatio: '16:9'
});

// Static file-based mock video
const staticConfig: VideoSourceConfig = {
  type: 'static',
  source: '/path/to/local/video.mp4',
  mimeType: 'video/mp4'
};

const videoBuffer = await generateMockVideo(staticConfig);
```

### Ambient Mode Video Generation

In ambient mode, videos are generated for b-roll content:

```typescript
import { prepareAmbientTurnFromText } from './broadcast/media-slots';

const generated = {
  title: "Ambient Scene",
  content: "A quiet moment in the story world",
  dialogue: undefined,
  imageRepresentations: []
};

const turn = await prepareAmbientTurnFromText(
  channelId,
  generated,
  runId,
  sequence,
  signal,
  true, // useVideo
  videoSourceConfig // VideoSourceConfig for mock generation
);
```

### Session Mode Video Generation

In session mode, videos are generated for canonical story blocks:

```typescript
import { finishCanonicalSlot } from './broadcast/media-slots';

const result = await finishCanonicalSlot(
  channelId,
  session,
  generated,
  signal,
  undefined, // useEmbedding
  true, // useVideo
  videoSourceConfig // VideoSourceConfig for mock generation
);
```

### Production Video Generation

The production video generation interface is ready for integration with actual video generation providers:

```typescript
import { generateVideo, type VideoGenerationOptions } from './media/video-service';

const options: VideoGenerationOptions = {
  references: [
    { type: 'text', content: 'A dramatic scene...' },
    { type: 'image', buffer: imageBuffer, mimeType: 'image/jpeg' }
  ],
  targetDurationSeconds: 15,
  aspectRatio: '16:9',
  includeAudio: true,
  signal: abortSignal
};

const videoBuffer = await generateVideo(description, options);
```

**Note:** Production video generation currently throws an error indicating provider integration is needed. Use mock video generation for testing until a video generation provider is integrated.

## Queue Broadcast Integration

Videos are submitted to the queue broadcast system as `QueueUploadAsset` objects:

```typescript
import { videoToUploadAsset } from './media/video-service';

const uploadAsset = await videoToUploadAsset(videoBuffer);
// {
//   data: Blob,
//   filename: string,
//   sha256: string
// }
```

The queue broadcast system handles video assets identically to image assets, using the same staging, release, and monitoring pipeline.

## Video vs Image Mode

### Image Mode (Original)
- Generates static images
- Separate TTS for audio narration
- Multiple slots for split narration
- Image + audio assets per slot

### Video Mode (New)
- Generates video with embedded audio
- No separate TTS needed
- Single slot per turn
- Video asset only per slot

### Switching Between Modes

Set `BROADCAST_USE_VIDEO` environment variable:
- `true`: Video generation with embedded audio
- `false` or unset: Image generation with TTS (original behavior)

## Testing

Run video service tests:
```bash
npm test -- server/media/video-service.test.ts
```

Run broadcast integration tests:
```bash
npm test -- server/broadcast/video-broadcast-integration.test.ts
```

## Implementation Details

### Video Buffer Structure

```typescript
interface VideoBuffer {
  buffer: Buffer;           // Raw video bytes
  durationSeconds: number;  // Video duration
  extension: string;        // File extension (mp4, webm, etc.)
  mimeType: string;         // MIME type (video/mp4, video/webm, etc.)
  filename: string;         // Generated filename
}
```

### Video Reference Types

Video generation accepts multiple reference types:

```typescript
type VideoReference = 
  | { type: "text"; content: string }           // Text description
  | { type: "image"; buffer: Buffer; mimeType: string }  // Image reference
  | { type: "video"; buffer: Buffer; mimeType: string }  // Video reference
  | { type: "url"; url: string };                // URL reference
```

### Video Archival

Videos are archived to GCS or local storage using the same infrastructure as images:

```typescript
import { archiveVideo } from './media/video-service';

const archiveUrl = await archiveVideo(videoBuffer, channelId, "ambient");
// Returns public HTTPS URL
```

## Performance Considerations

- Video files are significantly larger than images (MB vs KB)
- Video generation is slower than image generation
- Queue broadcast system handles video assets efficiently
- Consider bandwidth implications for client playback
- Use appropriate video quality/bitrate for streaming

## Future Enhancements

1. **Production Video Provider Integration**
   - Integrate with actual video generation APIs (e.g., Runway, Pika, etc.)
   - Support for video generation from text/image references
   - Configurable video quality and duration

2. **Video Format Support**
   - Additional video formats (WebM, MOV, etc.)
   - Adaptive bitrate streaming
   - Video compression optimization

3. **Advanced Video Features**
   - Video editing and post-processing
   - Multi-scene video generation
   - Video transitions and effects

## Troubleshooting

### Video Generation Fails

If video generation fails:
1. Check `BROADCAST_USE_VIDEO` environment variable
2. Verify video source URL or file path is accessible
3. Check video file format and MIME type
4. Review logs for specific error messages

### Queue Broadcast Issues

If video assets fail to reach the queue:
1. Verify video buffer is not empty
2. Check SHA256 hash generation
3. Ensure Blob creation succeeds
4. Review Streamer queue capacity

### Database Issues

If video URL persistence fails:
1. Ensure database migration ran successfully
2. Check `video_url` column exists in blocks table
3. Verify database connection and permissions

## Related Documentation

- [Broadcast Modes and Paths](./broadcast-modes-and-paths/)
- [Queue Broadcast Documentation](../packages/capability-queue-broadcast/)
- [Media Slots Implementation](../server/broadcast/media-slots.ts)
