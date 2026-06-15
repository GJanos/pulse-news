# Usage Tracking — Handover

**Date:** 2026-06-12
**Status:** PR #45 closed (wrong architecture). Vercel server setup required before reimplementation.
**Branch to delete:** `feat/usage-tracking` (carry-over from closed PR; do not merge)

---

## What PR #45 Did (Do Not Repeat)

PR #45 tracked events by writing directly from the phone to Supabase using the publishable key.
It was closed because:

- No server-side rate limiting or validation — any client could write arbitrary events
- Every article tap fired a network call — excessive, battery-draining, noisy data
- Publishable key in the DB write path is the wrong trust boundary for user analytics

### Code that was written in PR #45 (reference only)

| File                                   | What it did                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `app/src/analytics/track.ts`           | Fire-and-forget `trackEvent()` calling `supabase.from('usage_events').insert()` directly |
| `app/src/screens/ArticleScreen.tsx`    | `trackEvent('article_open')` on mount; `trackEvent('article_read')` on openArticle tap   |
| `app/src/components/DigestPage.tsx`    | `trackEvent('digest_viewed')` when digest loads and page is active                       |
| `cron/src/notify.ts`                   | Eviction of `usage_events` older than `db.evictUsageDays` days alongside digest eviction |
| `shared/src/config.ts`                 | Added `evictUsageDays: number` to `DbConfig`                                             |
| `shared/pulse.config.json`             | `"evictUsageDays": 90` in the `db` section                                               |
| `cron/src/config.ts`                   | Default `evictUsageDays: 90`; validation rule `>= 1`                                     |
| `supabase/schema.sql`                  | `usage_events` table + index + RLS (see schema section below)                            |
| `cron/src/tests/notify.test.ts`        | Added `evictUsageDays: 90` to `makeConfig()`                                             |
| `cron/src/tests/rankHeadlines.test.ts` | Added `evictUsageDays: 90` to `makeConfig()`                                             |

### Schema from PR #45 (keep this — it is still correct)

```sql
CREATE TABLE IF NOT EXISTS usage_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_user_occurred
  ON usage_events (user_id, occurred_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

-- Service-role key (cron) bypasses RLS; app will write via server endpoint
-- so no INSERT policy needed for the publishable key.
CREATE POLICY "users read own events"
  ON usage_events FOR SELECT USING (auth.uid() = user_id);
```

> Note: The INSERT policy from PR #45 (`WITH CHECK (auth.uid() = user_id)`) should **not** be
> recreated. The app will POST to a Vercel endpoint; the endpoint writes with the service-role key.
> No INSERT policy for the publishable key is needed.

---

## Correct Architecture

```
App session
  └─ in-memory buffer + MMKV persistence (@pulse/analytics_queue)
       └─ flush trigger (background / launch / logout / 50-event cap)
            └─ POST /api/events  (Vercel, JWT-verified)
                 └─ batch INSERT → usage_events  (service-role key)
```

---

## Prerequisites (Manual Steps Before Coding)

1. **Deploy to Vercel**
   - Connect the `GJanos/pulse-news` GitHub repo in the Vercel dashboard
   - Set env vars: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `FIREBASE_PROJECT_ID`,
     `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   - Verify `/api/account` is reachable at `https://<project>.vercel.app/api/account`
   - Vercel auto-deploys on push to `develop`

2. **Apply the DB migration** (schema above, minus the INSERT policy)

---

## Implementation Plan

### Phase A — Server endpoint: `cron/api/events.ts`

Pattern: identical to `cron/api/account.ts` (JWT verification via `db.auth.getUser(token)`).

```
POST /api/events
Authorization: Bearer <supabase-jwt>
Content-Type: application/json

{
  "events": [
    { "type": "article_read", "metadata": { "url": "...", "region": "GB" }, "occurred_at": "..." },
    { "type": "digest_viewed", "metadata": { "dates": ["2026-06-12"] }, "occurred_at": "..." }
  ]
}
```

Server responsibilities:

- Verify JWT → resolve `user_id`
- Validate each event `type` against allowlist: `['article_open', 'article_read', 'digest_viewed']`
- Strip any unexpected `metadata` keys (whitelist: `url`, `region`, `dates`, `count`)
- Batch-insert with service-role key
- Return `{ ok: true, saved: N }`
- Max payload: 100 events per request (guard against abuse)

### Phase B — App buffer: `app/src/analytics/buffer.ts`

```typescript
// Pseudocode — not production code
const QUEUE_KEY = '@pulse/analytics_queue';
const MAX_BUFFER = 50;

// trackEvent() — call from UI, no network
export function trackEvent(type, metadata) {
  const event = { type, metadata, occurred_at: new Date().toISOString() };
  pushToBuffer(event); // in-memory array
  persistBufferToMmkv(); // MMKV write for crash recovery
  if (buffer.length >= MAX_BUFFER) void flushBuffer(); // safety cap
}

// flushBuffer() — call on app background / launch / logout
export async function flushBuffer() {
  const events = readAndClearMmkv();
  if (!events.length) return;
  const token = getSession()?.access_token;
  if (!token) return; // unauthenticated — drop (user has no events row)
  await fetch(`${VERCEL_URL}/api/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  // On failure: re-enqueue events back into MMKV (or accept loss after N retries)
}
```

### Phase C — Flush triggers

| Trigger          | How                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| App → background | `AppState.addEventListener('change', state => { if (state === 'background') flushBuffer() })` in `useAppInit` or a new `useAnalyticsFlush` hook |
| App launch       | Call `flushBuffer()` early in `useAppInit`, before rendering, to recover crashed-session events                                                 |
| Logout           | Call `flushBuffer()` inside `deleteAccount()` and `signOut()` before clearing storage                                                           |
| Buffer hits 50   | Handled inside `trackEvent()` — auto-flushes                                                                                                    |

### Phase D — Revised event schema (less frequent)

Rather than one event per tap, collect during the session and flush once:

| Event           | When emitted into buffer                      | Metadata                                               |
| --------------- | --------------------------------------------- | ------------------------------------------------------ |
| `article_open`  | On ArticleScreen mount                        | `{ url, region }` — individual, low cardinality        |
| `article_read`  | On "Read full article" tap                    | `{ url, region }` — individual, intentional action     |
| `digest_viewed` | On DigestPage becoming active + digest loaded | `{ date }` — deduplicated per date per session via ref |

> `article_open` and `article_read` stay as individual events because they are low-frequency
> meaningful actions. `digest_viewed` fires at most once per date per session.
> None are high-frequency enough to be a problem when batched.

### Phase E — Config + eviction (carry over from PR #45, already correct)

- `db.evictUsageDays: 90` in `DbConfig` and `pulse.config.json`
- Cron evicts `usage_events` older than `evictUsageDays` inside `persistDigests` when `db.evict` is enabled
- These config changes from PR #45 must be re-applied on the new branch

---

## File Checklist for New Branch

```
New files:
  app/src/analytics/buffer.ts         ← buffer + flushBuffer()
  cron/api/events.ts                  ← POST /api/events handler

Modified files:
  shared/src/config.ts                ← add evictUsageDays to DbConfig
  shared/pulse.config.json            ← "evictUsageDays": 90
  cron/src/config.ts                  ← default + validation
  cron/src/notify.ts                  ← evict usage_events in persistDigests
  cron/src/tests/notify.test.ts       ← add evictUsageDays to makeConfig()
  cron/src/tests/rankHeadlines.test.ts← add evictUsageDays to makeConfig()
  supabase/schema.sql                 ← usage_events table (no INSERT RLS policy)
  app/src/screens/ArticleScreen.tsx   ← trackEvent calls (buffer, not direct)
  app/src/components/DigestPage.tsx   ← trackEvent('digest_viewed') (buffer)
  app/src/hooks/useAppInit.ts         ← flushBuffer() on launch + AppState listener
  app/src/hooks/useSupabaseAuth.ts    ← flushBuffer() before signOut/deleteAccount
  todo.md                             ← mark Phase 4 done
```

---

## Open Questions Before Starting

1. **Vercel project URL** — needs to be hardcoded or env-var'd in the app
   (`EXPO_PUBLIC_API_URL` or baked into `app/src/config.ts`)
2. **Flush on failure** — re-enqueue failed events or silently drop after 2 retries?
   Recommendation: drop after 2 retries (analytics loss is acceptable; retry loops are not)
3. **Unauthenticated sessions** — events from users who haven't signed in are dropped at flush time
   (no `user_id` to attach). Acceptable for V1.
