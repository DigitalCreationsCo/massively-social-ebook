# ControlRoom — Project Documentation

> Admin interface for sessions, channels, lore, blocks, users, and chat.
> Standalone Vite + React app. Lives at `/admin` in the repo root.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Environment Configuration](#3-environment-configuration)
4. [Authentication](#4-authentication)
5. [Database Schema Changes](#5-database-schema-changes)
6. [Server Changes](#6-server-changes)
   - 6.1 [Admin API Routes](#61-admin-api-routes)
   - 6.2 [Scheduler Refactor](#62-scheduler-refactor)
7. [Frontend Architecture](#7-frontend-architecture)
   - 7.1 [Tech Stack](#71-tech-stack)
   - 7.2 [App Structure](#72-app-structure)
   - 7.3 [API Client](#73-api-client)
   - 7.4 [Polling Strategy](#74-polling-strategy)
8. [UI Design System](#8-ui-design-system)
9. [Tabs — Functional Spec](#9-tabs--functional-spec)
   - 9.1 [Sessions](#91-sessions-tab)
   - 9.2 [Channels](#92-channels-tab)
   - 9.3 [Lore](#93-lore-tab)
   - 9.4 [Blocks](#94-blocks-tab)
   - 9.5 [Users](#95-users-tab)
   - 9.6 [Chat](#96-chat-tab)
   - 9.7 [Debug](#97-debug-tab)
10. [Deployment](#10-deployment)
11. [Migration & Compatibility Notes](#11-migration--compatibility-notes)
12. [Security Considerations](#12-security-considerations)
13. [Open Questions / Agent Decisions](#13-open-questions--agent-decisions)

---

## 1. Project Overview

ControlRoom replaces `client/src/components/DebugTools.tsx` with a fully self-contained
admin application. It is the single interface for all important backend data control and
is never served to end users.

**Core responsibilities:**

- Session scheduling: change dates, set recurring day/time intervals, view notify counts
- Channel management: create and manage channels that other entities reference via FK
- Lore and Blocks: full CRUD with channel scoping
- Users: read-only view with ban/unban controls
- Chat: view messages across channels, post as admin, delete messages
- Debug: all existing DebugTools functionality, preserved and organized

**What changed from DebugTools:**

| Before (DebugTools) | After (ControlRoom) |
|---|---|
| Embedded in the main client app | Standalone Vite app at `/admin` |
| Single component, no navigation | Tabbed layout with 7 tabs |
| Debug endpoints only | Full CRUD for all major entities |
| No session scheduling controls | Persistent day/time scheduling + notify counts |
| No channel management | Channels tab + FK relationships enforced |
| No user or chat management | Users tab (view + ban) + Chat tab (view + post + delete) |

---

## 2. Repository Structure

```
/                              ← repo root
├── client/                    ← existing frontend app (unchanged)
│   └── src/
│       └── components/
│           └── DebugTools.tsx ← DELETE after ControlRoom is verified
├── server/                    ← existing backend
│   ├── routes/
│   │   └── admin.ts           ← NEW: all /admin/* routes
│   └── scheduler.ts           ← REFACTORED: reads config from DB
└── admin/                     ← NEW: ControlRoom Vite app
    ├── .env                   ← shared defaults (committed)
    ├── .env.development       ← dev API URL (committed)
    ├── .env.production        ← prod API URL (committed)
    ├── .env.local             ← local token secret (gitignored)
    ├── .env.production.local  ← prod token secret (gitignored)
    ├── .gitignore
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/
        │   └── client.ts      ← typed fetch wrapper (token + base URL)
        ├── hooks/
        │   ├── usePolling.ts  ← generic auto-poll hook
        │   └── useAdminFetch.ts
        └── components/
            ├── Layout.tsx     ← top-level shell with tab bar
            ├── TabBar.tsx
            ├── shared/        ← reusable primitives (Badge, Modal, etc.)
            └── tabs/
                ├── SessionsTab.tsx
                ├── ChannelsTab.tsx
                ├── LoreTab.tsx
                ├── BlocksTab.tsx
                ├── UsersTab.tsx
                ├── ChatTab.tsx
                └── DebugTab.tsx
```

---

## 3. Environment Configuration

ControlRoom uses Vite's layered `.env` system. Files are loaded in priority order
(higher priority wins on conflict):

```
.env.{mode}.local  >  .env.{mode}  >  .env.local  >  .env
```

### File Purposes

| File | Commit? | Purpose |
|------|---------|---------|
| `.env` | ✅ Yes | Shared defaults across all environments |
| `.env.development` | ✅ Yes | Dev-specific non-secret values |
| `.env.production` | ✅ Yes | Prod-specific non-secret values |
| `.env.local` | ❌ No | Local machine secrets (any environment) |
| `.env.production.local` | ❌ No | Prod secrets, for CI/CD injection only |

### File Contents

**`.env`**
```env
VITE_POLL_INTERVAL_MS=10000
```

**`.env.development`**
```env
VITE_API_BASE_URL=http://localhost:3000
```

**`.env.production`**
```env
VITE_API_BASE_URL=https://api.yourproddomain.com
```

**`.env.local`** *(never committed)*
```env
VITE_ADMIN_TOKEN=your_dev_token_here
```

**`.env.production.local`** *(never committed — injected by CI)*
```env
VITE_ADMIN_TOKEN=your_prod_token_here
```

### `.gitignore` (inside `/admin`)

```
*.local
dist/
node_modules/
```

The `*.local` pattern covers all `.env.*.local` files — secrets never reach git.

### Running Each Environment

```bash
# Dev server — loads .env + .env.development + .env.local
npm run dev

# Production build — loads .env + .env.production + .env.production.local
npm run build

# Preview the production build locally
npm run preview
```

### CI/CD (GitHub Actions example)

Inject production secrets at build time via repository secrets — never store them in
any committed file:

```yaml
- name: Build ControlRoom
  working-directory: ./admin
  run: npm run build
  env:
    VITE_ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
```

`VITE_API_BASE_URL` for production is already in `.env.production` (committed), so
it does not need to be injected as a secret unless it is itself sensitive.

---

## 4. Authentication

### Mechanism

Every request from ControlRoom includes a bearer token header:

```
Authorization: Bearer <VITE_ADMIN_TOKEN>
```

The token value comes from the `VITE_ADMIN_TOKEN` environment variable, set per the
rules in Section 3.

### Server Middleware

All `/admin/*` routes are protected by a single middleware guard in
`server/routes/admin.ts`:

```ts
function requireAdminToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
```

`process.env.ADMIN_TOKEN` on the server side is set in the server's own `.env` (not
the admin Vite app's `.env`). The client token and the server token must match.

### UI Behavior on Auth Failure

If any request returns `401`, the UI replaces the entire viewport with a full-screen
error state:

```
⚠ Unauthorized
ADMIN_TOKEN is missing or incorrect.
Check your .env.local configuration.
```

No tab content is rendered until the token is valid.

### Token Storage

The token lives only in the Vite environment at build time — it is baked into the
compiled JS bundle. Because of this, the `/admin` build output must **never** be
publicly served. See Section 12 (Security) for access restriction options.

---

## 5. Database Schema Changes

All changes are additive. No existing columns are modified or dropped.

### 5.1 New Table: `channels`

```sql
CREATE TABLE channels (
  id          SERIAL PRIMARY KEY,
  channelId   TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  createdAt   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 5.2 Foreign Key Migration

Every table that currently contains a `channelId TEXT` column receives a foreign key
constraint referencing `channels(channelId)`. The coding agent must identify all such
tables by inspecting the existing schema.

Example migration pattern per table:

```sql
ALTER TABLE <table_name>
  ADD CONSTRAINT fk_<table_name>_channel
  FOREIGN KEY (channelId) REFERENCES channels(channelId);
```

If existing rows contain `channelId` values that do not exist in `channels`, those
values must be inserted into `channels` before the constraint is applied (or the
constraint must be added as `NOT VALID` and validated separately).

### 5.3 Sessions Table: Scheduling Fields

```sql
ALTER TABLE sessions
  ADD COLUMN scheduledDays    TEXT[]     DEFAULT '{}',
  ADD COLUMN scheduledTime    TIME,
  ADD COLUMN intervalEnabled  BOOLEAN    NOT NULL DEFAULT false,
  ADD COLUMN timezone         TEXT       NOT NULL DEFAULT 'UTC',
  ADD COLUMN nextRunAt        TIMESTAMPTZ,
  ADD COLUMN notifyCount      INT        NOT NULL DEFAULT 0;
```

| Column | Type | Purpose |
|---|---|---|
| `scheduledDays` | `TEXT[]` | Days of week to run, e.g. `['monday','wednesday']` |
| `scheduledTime` | `TIME` | Local time of day for the session, e.g. `14:30` |
| `intervalEnabled` | `BOOLEAN` | Whether the recurring schedule is active |
| `timezone` | `TEXT` | IANA timezone string, e.g. `America/New_York` |
| `nextRunAt` | `TIMESTAMPTZ` | Next scheduled execution, computed and written by scheduler |
| `notifyCount` | `INT` | Cumulative number of users notified, incremented on each run |

### 5.4 Migration File

Provide a single migration file (`migrations/YYYYMMDD_controlroom.sql` or equivalent
Prisma migration) containing all of the above DDL in the correct dependency order:

1. Create `channels` table
2. Add scheduling columns to `sessions`
3. Add FK constraints to tables with `channelId`

---

## 6. Server Changes

### 6.1 Admin API Routes

All routes live in `server/routes/admin.ts` and are mounted at `/admin`.
All routes require the `requireAdminToken` middleware (see Section 4).

#### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/sessions` | List all sessions including `notifyCount`, `nextRunAt`, `scheduledDays`, `scheduledTime`, `timezone`, `intervalEnabled` |
| `POST` | `/admin/sessions` | Create a new session |
| `PATCH` | `/admin/sessions/:id` | Update session fields |
| `DELETE` | `/admin/sessions/:id` | Delete session |
| `POST` | `/admin/sessions/:id/reload` | Trigger `reloadScheduler()` after a schedule change |

#### Channels

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/channels` | List all channels |
| `POST` | `/admin/channels` | Create channel |
| `PATCH` | `/admin/channels/:id` | Update channel name or description |
| `DELETE` | `/admin/channels/:id` | Delete channel (fails with 409 if FK dependents exist) |

#### Lore

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/lore` | List all lore entries; supports `?channelId=` filter |
| `POST` | `/admin/lore` | Create lore entry |
| `PATCH` | `/admin/lore/:id` | Update lore entry |
| `DELETE` | `/admin/lore/:id` | Delete lore entry |

#### Blocks

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/blocks` | List all blocks; supports `?channelId=` filter |
| `POST` | `/admin/blocks` | Create block |
| `PATCH` | `/admin/blocks/:id` | Update block |
| `DELETE` | `/admin/blocks/:id` | Delete block |

#### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/users` | List users; supports `?search=`, `?page=`, `?limit=` |
| `PATCH` | `/admin/users/:id/ban` | Ban or unban user (`{ banned: true/false }`) |

#### Chat

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/chat/messages` | List messages; supports `?channelId=`, `?page=`, `?limit=` |
| `POST` | `/admin/chat/messages` | Post a message as admin (`{ channelId, body }`) |
| `DELETE` | `/admin/chat/messages/:id` | Delete a message |

#### Debug

All existing debug endpoints are migrated to `/admin/debug/*`. The exact paths are
determined by the coding agent based on the existing DebugTools implementation.

---

### 6.2 Scheduler Refactor (`server/scheduler.ts`)

**Current state:** Scheduler uses hardcoded interval and time values.

**Refactored behavior:**

1. **On startup**, load all sessions where `intervalEnabled = true` from the database.
2. For each such session, schedule a recurring job based on `scheduledDays`,
   `scheduledTime`, and `timezone`.
3. After each notify run, write back to the session row:
   - Increment `notifyCount` by the number of users notified in that run
   - Compute and persist `nextRunAt` for the next scheduled occurrence
4. Expose a `reloadScheduler()` function that:
   - Cancels all currently scheduled jobs
   - Re-reads all `intervalEnabled = true` sessions from the database
   - Re-schedules them fresh
   - Is safe to call concurrently (debounce or queue rapid calls)
5. `reloadScheduler()` is called by `POST /admin/sessions/:id/reload` after any
   scheduling change is saved via the Sessions tab.

**Scheduling logic (day-of-week + time):**

Given `scheduledDays = ['monday', 'wednesday']`, `scheduledTime = '14:30'`,
`timezone = 'America/New_York'`, the scheduler must:
- Convert the local day+time to the correct UTC equivalent on each calculation
- Account for DST transitions using an IANA-aware library (e.g. `date-fns-tz` or
  `luxon`)
- Set `nextRunAt` to the next future occurrence across all scheduled days

---

## 7. Frontend Architecture

### 7.1 Tech Stack

| Concern | Choice |
|---|---|
| Build tool | Vite |
| UI framework | React 18 + TypeScript |
| Styling | Tailwind CSS |
| HTTP | Native `fetch` (no axios) |
| State | React `useState` / `useReducer` (no Redux) |
| Routing | None — tab state managed in `App.tsx` |
| Component library | None — primitives built directly |

### 7.2 App Structure

`App.tsx` holds the active tab state and renders `Layout`, which renders `TabBar` and
the active tab component. No client-side router is needed.

```tsx
const TABS = ['Sessions', 'Channels', 'Lore', 'Blocks', 'Users', 'Chat', 'Debug'];

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('Sessions');

  return (
    <Layout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'Sessions' && <SessionsTab />}
      {activeTab === 'Channels' && <ChannelsTab />}
      {/* ... */}
    </Layout>
  );
}
```

### 7.3 API Client

`src/api/client.ts` exports a single `adminFetch` wrapper used by all tabs:

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL;
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN;

export async function adminFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
      ...options?.headers,
    },
  });

  if (res.status === 401) throw new AuthError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
```

Typed endpoint wrappers (one per resource) live alongside `client.ts`:

```ts
// src/api/sessions.ts
export const getSessions = () => adminFetch<Session[]>('/admin/sessions');
export const patchSession = (id: number, data: Partial<Session>) =>
  adminFetch<Session>(`/admin/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
// etc.
```

### 7.4 Polling Strategy

A generic `usePolling` hook handles all auto-refresh behavior:

```ts
function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = Number(import.meta.env.VITE_POLL_INTERVAL_MS)
): { data: T | null; loading: boolean; error: Error | null; refresh: () => void }
```

**Behavior:**
- Fetches immediately on mount
- Re-fetches every `intervalMs` milliseconds
- Pauses when the browser tab loses focus (`document.visibilityState === 'hidden'`)
- Resumes and immediately re-fetches when focus returns
- `refresh()` triggers an immediate out-of-cycle fetch
- Each tab component uses its own `usePolling` instance, so tabs poll independently

**Last-updated display:**
Each tab shows a muted timestamp line: `Last updated 8s ago · ↻ Refresh`

---

## 8. UI Design System

### Principles

- **Minimalist**: no decorative chrome, no gradients, no drop shadows unless load-bearing
- **Info-dense**: 13px body text, 4px base spacing unit, compact row heights (36–40px)
- **Organized**: clear typographic hierarchy, consistent column alignment in tables
- **Readable**: sufficient contrast, status always communicated in text + color

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ControlRoom          [Sessions] [Channels] [Lore] [Blocks]  │
│                       [Users] [Chat] [Debug]                 │
├─────────────────────────────────────────────────────────────┤
│  Tab content area (full remaining height, scrollable)        │
│                                                              │
│  Last updated 8s ago · ↻ Refresh          [+ New]           │
│  ┌──────┬────────────┬──────────┬────────┬────────────────┐  │
│  │ ID   │ Name       │ Channel  │ Status │ Actions        │  │
│  ├──────┼────────────┼──────────┼────────┼────────────────┤  │
│  │ ...  │ ...        │ ...      │ ...    │ Edit · Delete  │  │
│  └──────┴────────────┴──────────┴────────┴────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Color Palette (Tailwind classes)

| Role | Class |
|---|---|
| Page background | `bg-zinc-950` |
| Surface (panels, cards) | `bg-zinc-900` |
| Border | `border-zinc-800` |
| Body text | `text-zinc-100` |
| Muted text | `text-zinc-400` |
| Active tab underline | `border-b-2 border-white` |
| Primary action button | `bg-zinc-100 text-zinc-950` |
| Destructive action | `text-red-400 hover:text-red-300` |
| Badge: active/success | `bg-emerald-900 text-emerald-300` |
| Badge: inactive/warning | `bg-zinc-700 text-zinc-300` |
| Badge: banned/error | `bg-red-900 text-red-300` |

### Tables

- Sticky `<thead>` with `bg-zinc-900`
- Alternating row backgrounds: `bg-zinc-950` / `bg-zinc-900`
- Row height: `h-9` (36px)
- Inline editing activates on row click or pencil icon click; renders an `<input>` or
  `<select>` in-cell; saves on blur or Enter
- Destructive row actions use a small `Delete` text button that opens a one-line
  inline confirm: `Are you sure? [Confirm] [Cancel]`

### Badges

```tsx
<Badge variant="active">Active</Badge>
<Badge variant="inactive">Inactive</Badge>
<Badge variant="banned">Banned</Badge>
```

Always include both a color indicator and a text label — never color alone.

### Modals

Used only for:
- Confirming deletion of entities with potential FK dependents (e.g. channels)
- Multi-field create forms that do not fit cleanly inline

Keep modals small — max `w-md`. No full-screen overlays.

---

## 9. Tabs — Functional Spec

### 9.1 Sessions Tab

**Table columns:**

| Column | Notes |
|---|---|
| ID | Numeric |
| Name / Title | Inline editable |
| Channel | Dropdown (populated from channels list) |
| Status | Badge |
| Scheduled Days | Multi-checkbox popover: Mon Tue Wed Thu Fri Sat Sun |
| Scheduled Time | Time input (HH:MM) |
| Timezone | Searchable dropdown (IANA list) |
| Interval Enabled | Toggle switch |
| Notify Count | Numeric badge |
| Next Run At | Relative time ("in 3h 20m"); absolute datetime on hover |
| Created At | Date |
| Actions | Save · Delete |

**Behaviors:**
- Editing any scheduling field on a row reveals a `Save` button for that row
- On save: `PATCH /admin/sessions/:id`, then `POST /admin/sessions/:id/reload`
- `intervalEnabled` toggle saves immediately (no explicit Save needed) and triggers reload
- `notifyCount` is read-only — server increments it
- Create: inline empty row at top of table with all fields; confirm with `Create` button
- Delete: inline confirm → `DELETE /admin/sessions/:id`

---

### 9.2 Channels Tab

**Table columns:** ID · Channel ID · Name · Description · Created At · Actions

**Behaviors:**
- `channelId` is set on create and **not editable** afterward (other entities FK on it)
- Name and Description are inline editable
- Delete: if the channel has FK dependents, the server returns 409; the UI shows:
  `Cannot delete: this channel is referenced by X sessions, Y lore entries, …`
  using a modal so the user can read the full message
- Create: modal form with fields for `channelId`, `name`, `description`

---

### 9.3 Lore Tab

**Table columns:** ID · Channel · Title (or key field) · [content preview] · Created At · Actions

**Behaviors:**
- Filter by channel: dropdown at top of tab, defaults to "All channels"
- Inline editing for all text fields
- Create and Delete follow the same patterns as other tabs
- `channelId` field renders as a dropdown populated from the channels list

---

### 9.4 Blocks Tab

**Table columns:** ID · Channel · Type (if applicable) · Content preview · Created At · Actions

**Behaviors:**
- Filter by channel (same as Lore)
- Inline editing
- `channelId` rendered as channel name dropdown

---

### 9.5 Users Tab

**Table columns:** ID · Username · Email · Status (active/banned) · Created At · Last Active

**Behaviors:**
- Paginated: 50 rows per page, offset-based, with `< Prev` / `Next >` controls
- Search input at top: filters by username or email via `?search=` query param
- Ban/unban: toggle button per row — shows `Ban` when active, `Unban` when banned
  - Click `Ban` → inline confirm: `Ban this user? [Confirm] [Cancel]`
  - On confirm: `PATCH /admin/users/:id/ban { banned: true }`
- No other edits — all other columns are read-only

---

### 9.6 Chat Tab

**Layout:** Vertical split.
- Top section (≈65% height): message list
- Bottom section (≈35% height): compose panel

**Message list:**
- Filter by channel: dropdown at top, defaults to "All channels"
- Paginated, newest-first, 50 messages per page
- Columns: Timestamp · Channel · Username · Message (truncated to ~80 chars) · Delete
- Delete: inline confirm per row → `DELETE /admin/chat/messages/:id`
- Admin-posted messages are visually distinguished (e.g. `[admin]` badge on username)

**Compose panel:**
- Channel selector (required)
- Textarea for message body
- `Post as Admin` button — disabled while empty or while a post is in-flight
- Below the textarea: last 3 admin-posted messages shown as a confirmation log
  (timestamp + body preview)

---

### 9.7 Debug Tab

All functionality migrated verbatim from `client/src/components/DebugTools.tsx`.

**Organization:**
- Group existing debug controls into collapsible sections if there are more than ~5
  distinct actions
- Each section has a header with a toggle arrow
- Sections default to collapsed; last open/closed state persisted to `localStorage`

**Endpoints:**
- All existing debug endpoints moved to `/admin/debug/*` on the server
- No behavior changes — pure migration

---

## 10. Deployment

### Build Output

```bash
cd admin
npm run build
# Output: admin/dist/
```

`admin/dist/` contains a static site (HTML + JS + CSS). Deploy it anywhere that serves
static files: Nginx, Caddy, S3 + CloudFront, Vercel, Netlify, etc.

### Serving Separately from the Main App

The ControlRoom build is a separate static site. It does not need to be served from the
same origin as the main client app. It only needs network access to the server's
`/admin/*` routes. Configure CORS on the server to allow the ControlRoom origin if they
are on different domains.

### Recommended: Serve Behind Access Restriction

Because the `ADMIN_TOKEN` is baked into the JS bundle, add a second layer of access
control at the web server or CDN level. Options (in order of preference):

1. **VPN / private network** — serve `admin/dist/` on an internal URL not exposed to the
   public internet
2. **IP allowlist** — Nginx/Caddy rule allowing only known office or developer IPs
3. **HTTP Basic Auth** — Nginx `auth_basic` in front of the static files
4. **Cloudflare Access** — zero-trust identity gate in front of the CDN origin

Do not rely solely on the `ADMIN_TOKEN` as the only access control.

### Example Nginx Config

```nginx
server {
  listen 443 ssl;
  server_name admin.yourproddomain.com;

  # Option: IP allowlist
  allow 203.0.113.0/24;  # office IP range
  deny all;

  root /var/www/controlroom/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

---

## 11. Migration & Compatibility Notes

### Removing DebugTools

1. Deploy ControlRoom and verify all debug functionality works in the Debug tab
2. Remove `client/src/components/DebugTools.tsx`
3. Remove any import or usage of `DebugTools` in the client app
4. Remove any debug-only routes that are now handled by `/admin/debug/*`

### Schema Migration Order

Run the migration file in this order to avoid FK violations:

1. Create `channels` table
2. Backfill `channels` rows for any existing `channelId` values found in other tables
3. Add FK constraints to dependent tables
4. Add scheduling columns to `sessions`

### No Breaking Changes to Existing Client

- No existing client-facing API routes are modified
- No existing table columns are removed or renamed
- The main client app continues to function unchanged during and after the migration

---

## 12. Security Considerations

| Risk | Mitigation |
|---|---|
| `ADMIN_TOKEN` in git | Stored only in `.env.local` / `.env.production.local` (gitignored via `*.local`) |
| `ADMIN_TOKEN` in JS bundle | Admin build never publicly served — restricted by network/IP/VPN |
| Unauthorized server access | `requireAdminToken` middleware on every `/admin/*` route |
| Token exposure in CI logs | Injected as a masked GitHub Actions secret (`${{ secrets.ADMIN_TOKEN }}`) |
| FK cascade deletes | Channel delete endpoint returns 409 before attempting delete if dependents exist |
| Admin chat impersonation | Messages posted via `/admin/chat/messages` are flagged server-side as admin-origin |

---

## 13. Open Questions / Agent Decisions

The following decisions are left to the coding agent, who should use the existing
codebase as the source of truth:

- **Which tables have `channelId`?** — Inspect the schema and apply FK migration to all
  of them. Do not assume; check.
- **Prisma or raw SQL?** — Use whichever migration system the project already uses.
- **Pagination strategy** — Use cursor-based or offset-based pagination matching whatever
  pattern already exists in other endpoints.
- **`reloadScheduler()` concurrency** — If the scheduler could be reloaded rapidly (e.g.
  multiple saves in quick succession), debounce or queue calls to avoid race conditions.
- **Lore and Blocks schema** — The exact columns for these tables are unknown at spec time.
  The agent should read the existing schema and expose all fields in the respective tabs.
- **Debug endpoint paths** — Determined by the existing DebugTools implementation. Move
  them under `/admin/debug/*` and update the Debug tab's fetch calls accordingly.
- **Session name/title field** — The spec assumes sessions have a displayable name or
  title. The agent should use whatever the actual column is called.