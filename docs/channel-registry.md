# Channel registry and required Px entities

## Purpose

The channel registry makes required narrative entities a startup dependency.
It replaces the split `BROADCAST_CHANNELS_JSON` environment variable and the
hard-coded Px entity map. This prevents sessions and ambient playback from
starting with random or missing canonical characters and locations when Px is
temporarily unavailable later in the process lifetime.

## Registry location and security

Set `CHANNEL_REGISTRY_PATH` to an absolute or application-relative path:

```dotenv
CHANNEL_REGISTRY_PATH="./channel-registry.json"
```

The registry is deployment-local and ignored by Git because endpoints and other
infrastructure details may differ by environment. Secret values do not belong
in it: use environment-variable references such as `queueTokenEnv` instead.

The application rewrites this file at startup. Its temporary file is created
with owner-only permissions (`0600`) and atomically renamed over the old file.
Give the running process write access to the file's directory. In a container,
mount a persistent writable volume; an image-only filesystem will make startup
fail as designed.

Start from `channel-registry.example.json` in the repository root.

## Format

```json
{
  "channels": {
    "25th-chapter": {
      "controlEndpoint": "https://streamer.example.com",
      "queueTokenEnv": "BROADCAST_QUEUE_TOKEN",
      "requiredEntities": [
        "px://25th-chapter/character/claire-cole",
        "px://25th-chapter/character/nathan-gunn"
      ],
      "youtube": {
        "liveChatId": "youtube-live-chat-id",
        "clientIdEnv": "YOUTUBE_CLIENT_ID",
        "clientSecretEnv": "YOUTUBE_CLIENT_SECRET",
        "refreshTokenEnv": "YOUTUBE_REFRESH_TOKEN"
      }
    }
  },
  "entities": {},
  "entitiesFetchedAt": "2026-01-01T00:00:00.000Z"
}
```

`channels` is operator-managed configuration. Every channel must provide a
URL-safe ID, a control endpoint (or temporarily the legacy `endpoint`), a
queue-token environment-variable name, and at least one `requiredEntities`
URI. You can also configure `youtube` and `twitch` provider connector objects
with their existing environment-variable references.

`entities` and `entitiesFetchedAt` are application-managed cache fields. Do not
hand-edit cached manifests; the next successful startup replaces the complete
record. `entities` is keyed by PX URI and contains the full Px/PX manifest,
including properties and representations.

## Startup sequence

1. The server reads and validates the registry.
2. It deduplicates all required entity URIs across channels.
3. It resolves each URI with `px_resolve` through Px, requesting full JSON
   manifests.
4. It validates that every returned manifest is canonical and matches the URI
   requested.
5. Only after every resolution succeeds, it writes the complete `entities`
   record and an ISO `entitiesFetchedAt` timestamp atomically.
6. Routes, broadcast workers, sessions, and ambient generation initialize.

This is intentionally fail-closed. Px timeout/unavailability, a malformed or
mismatched manifest, invalid JSON, a missing registry, or write failure stops
the process before it can serve traffic. The server does not fall back to an
older cache at startup.

During normal operation, a live Px/MCP failure does not remove the
startup-validated required manifests from narrative context. Px returns those
cached required manifests so canonical visual and narrative references remain
available for sessions and ambient turns. Non-required, story-mentioned
entities still depend on the live Px request.

## Migration from `BROADCAST_CHANNELS_JSON`

1. Copy the example file to the desired deployment-local path.
2. Move each former top-level channel object under `channels`.
3. Add a non-empty `requiredEntities` URI list to every channel.
4. Leave `entities` empty; startup fills it.
5. Set `CHANNEL_REGISTRY_PATH` and retain the referenced token/OAuth
   environment variables.
6. Remove `BROADCAST_CHANNELS_JSON` from development and deployment secrets.
7. Restart the application and confirm the registry now contains complete
   manifests and a current `entitiesFetchedAt` value.

Changing required entities takes effect on the next process restart. There is
no live refresh endpoint by design.

## Troubleshooting

| Symptom | Meaning and action |
| --- | --- |
| Server exits before listening | Read the first channel-registry/Px error. Check `CHANNEL_REGISTRY_PATH`, its parent directory permissions, JSON syntax, and every required URI. |
| `PX startup manifest resolution failed` | Verify the PX/Px configuration and that `px-mcp-server` can resolve each configured URI. |
| Write/rename error | The registry path or its parent directory is read-only. Mount a writable persistent volume and restart. |
| A required profile looks outdated | Update the PX entity, then restart the app. Startup is the only refresh point. |
| A non-required profile is missing during an episode | Only required entities are guaranteed from the cache. Add the URI to that channel's `requiredEntities` if it must always be present. |
