# Video Streaming Implementation

This document describes the production-ready video streaming capability added to the massively-social-ebook project for both ambient mode and session mode broadcast operations.

## Overview

The video streaming feature enables generation and playback of video content with embedded audio as an alternative to the existing image + TTS (text-to-speech) pipeline. Videos are submitted to the queue broadcast system and streamed in the app client, providing a more immersive experience for story content.

**Production-Ready Features:**
- ✅ OpenRouter and Fal.ai video generation provider integration
- ✅ Configurable daily cost controls for video generation
- ✅ Video saving configuration (session vs ambient mode)
- ✅ Error handling and fallbacks for video generation
- ✅ Cost-effective default configuration (short duration, 720p resolution)
- ✅ Support for text, image, and video references

## Architecture

### Components

1. **AI Provider** (`server/blocks/ai-provider.ts`)
   - Extended with video capability support
   - OpenRouter video generation integration (google/veo-3.1)
   - Fal.ai video generation integration (fal-ai/veo3.1)
   - Daily cost control state management
   - Video saving configuration

2. **Video Service** (`server/media/video-service.ts`)
   - Core video generation interface with production providers
   - Mock video generation for testing (static files and URLs)
   - Video archival with configuration-based saving
   - Queue upload asset conversion
   - Video buffer validation

3. **Media Slots** (`server/broadcast/media-slots.ts`)
   - Extended to support video assets in `PreparedAmbientTurn` and `PreparedBroadcastSlot`
   - Video generation integrated into `generateTurnMedia` pipeline
   - Video-aware slot creation for queue broadcast
   - Configuration-based video archival

4. **Coordinator** (`server/broadcast/coordinator.ts`)
   - Environment-based video generation configuration
   - Video generation for both ambient and session modes
   - Queue broadcast integration

### Data Flow

```
Text/Reference → AI Provider (OpenRouter/Fal) → Video Buffer → Queue Upload Asset → Streamer Queue → Client Playback
              ↓
         Cost Control Check
              ↓
         Archival (if configured)
```

## Configuration

### Environment Variables

Enable video streaming by setting the following environment variables:

```bash
# Enable video generation (default: false)
BROADCAST_USE_VIDEO=true

# Video provider selection (default: openrouter)
AI_VIDEO_PROVIDER=openrouter  # or "fal"
AI_VIDEO_MODEL=google/veo-3.1  # or "fal-ai/veo3.1"

# Provider API keys
OPENROUTER_API_KEY=your-openrouter-api-key
FAL_KEY=your-fal-api-key

# Cost control configuration
VIDEO_DAILY_BUDGET_USD=10  # Daily budget limit in USD (default: 10)

# Video saving configuration
VIDEO_SAVE_SESSION=true   # Save videos generated in session mode (default: true)
VIDEO_SAVE_AMBIENT=false  # Save videos generated in ambient mode (default: false)

# Video source for mock generation (testing only)
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

The production video generation uses OpenRouter or Fal.ai providers:

```typescript
import { generateVideo, type VideoGenerationOptions } from './media/video-service';

const options: VideoGenerationOptions = {
  references: [
    { type: 'image', buffer: imageBuffer, mimeType: 'image/jpeg' }
  ],
  targetDurationSeconds: 5,  // Short duration for cost control
  aspectRatio: '16:9',
  includeAudio: true,
  signal: abortSignal
};

const videoBuffer = await generateVideo(description, options);
```

**Provider Integration:**
- **OpenRouter**: Uses `google/veo-3.1` model by default
- **Fal.ai**: Uses `fal-ai/veo3.1` model by default
- Both providers support text-to-video and image-to-video generation
- Video generation includes embedded audio (no separate TTS needed)

**Cost Control:**
- Daily budget limit enforced via `VIDEO_DAILY_BUDGET_USD`
- Estimated costs: OpenRouter ~$0.50/second (720p), Fal.ai ~$0.03/second (720p)
- Automatic budget tracking and reset at midnight
- Video generation rejected if budget exceeded

**Video Saving:**
- Session videos saved by default (`VIDEO_SAVE_SESSION=true`)
- Ambient videos not saved by default (`VIDEO_SAVE_AMBIENT=false`)
- Configurable per environment
- Archives to GCS or local storage based on infrastructure

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

1. **Additional Video Providers**
   - Integration with other video generation APIs (Runway, Pika, etc.)
   - Support for more advanced video models
   - Provider-specific feature support

2. **Video Format Support**
   - Additional video formats (WebM, MOV, etc.)
   - Adaptive bitrate streaming
   - Video compression optimization

3. **Advanced Video Features**
   - Video editing and post-processing
   - Multi-scene video generation
   - Video transitions and effects
   - Video reference extraction from existing videos

4. **Enhanced Cost Controls**
   - Per-user cost limits
   - Cost analytics and reporting
   - Predictive cost estimation
   - Budget alerts and notifications

## Troubleshooting

### Video Generation Fails

If video generation fails:
1. Check `BROADCAST_USE_VIDEO` environment variable
2. Verify `AI_VIDEO_PROVIDER` and `AI_VIDEO_MODEL` are set correctly
3. Check provider API keys (`OPENROUTER_API_KEY` or `FAL_KEY`)
4. Verify video source URL or file path is accessible (for mock generation)
5. Check video file format and MIME type
6. Review logs for specific error messages

### Cost Control Issues

If video generation is rejected due to cost limits:
1. Check `VIDEO_DAILY_BUDGET_USD` setting
2. Review current cost state using `getVideoCostControlState()`
3. Consider increasing budget or reducing video duration/resolution
4. Check provider pricing and estimated costs

### Provider-Specific Issues

**OpenRouter:**
- Verify API key has video generation permissions
- Check OpenRouter account balance and quota
- Review OpenRouter status page for service issues

**Fal.ai:**
- Verify `FAL_KEY` is valid and has sufficient credits
- Check Fal.ai account balance and quota
- Review Fal.ai status page for service issues

### Queue Broadcast Issues

If video assets fail to reach the queue:
1. Verify video buffer is not empty
2. Check SHA256 hash generation
3. Ensure Blob creation succeeds
4. Review Streamer queue capacity
5. Check video file size limits

### Database Issues

If video URL persistence fails:
1. Ensure database migration ran successfully
2. Check `video_url` column exists in blocks table
3. Verify database connection and permissions
4. Check video saving configuration (`VIDEO_SAVE_SESSION`, `VIDEO_SAVE_AMBIENT`)

### Video Saving Issues

If videos are not being archived:
1. Check video saving configuration
2. Verify GCS credentials and bucket access
3. Check `PUBLIC_BASE_URL` for local storage fallback
4. Review storage manager logs

## Related Documentation

- [Broadcast Modes and Paths](./broadcast-modes-and-paths/)
- [Queue Broadcast Documentation](../packages/capability-queue-broadcast/)
- [Media Slots Implementation](../server/broadcast/media-slots.ts)
