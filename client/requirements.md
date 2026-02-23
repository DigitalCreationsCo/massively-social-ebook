## Packages
framer-motion | Required for cinematic image crossfades and smooth UI transitions
lucide-react | High quality icons for the chat and UI elements
clsx | Utility for constructing className strings conditionally
tailwind-merge | Utility for merging tailwind classes without style conflicts

## Notes
- PWA manifest will be placed in `client/public/manifest.json`.
- The application assumes the backend serves a WebSocket at `ws://${window.location.host}/ws`.
- Expected WebSocket payloads:
  - SERVER -> CLIENT: `sync_state` (updates story block, phase, timeRemaining)
  - SERVER -> CLIENT: `chat_message` (broadcasts new chat message)
  - CLIENT -> SERVER: `submit_chat` (sends a new message)
  - CLIENT -> SERVER: `submit_vote` (submits user vote for next block)
- Mobile UX: `100dvh` is used for the main container to prevent iOS Safari bottom bar issues, and `overscroll-none` disables pull-to-refresh.
