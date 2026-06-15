# Notify catch-up windows — design

**Date:** 2026-06-15
**Status:** Approved, pending implementation plan
**Area:** `cron/` (notify job) + `supabase/` schema

## Problem

`jobs/notify.ts` notifies devices whose `notify_at` (a `TIME` of day) falls in a
fixed 30-minute window ending at "now". This is only correct if the GitHub
Actions schedule (`*/30 * * * *` in `.github/workflows/notify.yml`) actually
fires every 30 minutes.

It does not. Observed Notify runs on 2026-06-14/15 fired roughly 3–4 times in a
day (e.g. 02:15, 07:38, 14:22) instead of 48 times. Every device whose
`notify_at` fell inside one of those multi-hour gaps was never queried and never
notified. The reporting user received **zero** notifications for this reason.

`daily-digest.ts` handles devices with `notify_at = NULL` ("notify me when the
digest is ready") and is **out of scope** — it stays exactly as is. The two
workflows remain separate.

## Goal

Replace the fixed 30-minute window with a window of `(last_run, now]`, so no
time-of-day can fall through a gap between unreliable runs. Preserve behaviour in
the reliable case: if the schedule fires every 30 minutes, `last_run ≈ now − 30
min` and the same devices are selected — no regression.

A secondary goal is to remove now-unnecessary logic (window snapping, the
`NOTIFY_WINDOW_*` env plumbing, `notifyWindow.ts`).

## Key decisions

1. **Run memory: a global last-run timestamp.** A singleton `notify_state` row
   holds `last_run_at`. Chosen over a per-device `last_notified_at` column
   because it is contained entirely to `cron/` + Supabase (no app changes) and
   matches the "between this run and the last run" model directly.

2. **Selection logic lives once, in Supabase RPCs.** Both the cost-saving guard
   step and the job must agree on "who is due". Putting the date math in SQL lets
   both call the same function. This deletes `notifyWindow.ts` and the
   `NOTIFY_WINDOW_START/END` env plumbing entirely.

3. **At-most-once delivery.** `last_run_at` advances in the same RPC call that
   returns the due tokens, before dispatch. A hard FCM outage can therefore drop
   one window's notifications. This is preferred over double-notify spam and is
   orthogonal to the actual failure (the runner not firing, not FCM failing).
   Per-token failures are already tolerated by `dispatchFcm`, which returns
   `sent/total`.

## The selection rule

Instead of windows with explicit midnight-wrap and ">24h outage" branches, a
single per-device predicate covers every case:

> A device is **due** iff the **most recent occurrence of its `notify_at` time
> at-or-before now** is **later than `last_run_at`**.

```
most_recent_occurrence(T, now) =
    today@T      if T <= now's UTC time-of-day   -- already happened today
    yesterday@T  otherwise                        -- hasn't happened yet today

device is due  ⟺  most_recent_occurrence(notify_at, now) > last_run_at
```

`notify_at` is treated as a **UTC** time-of-day, consistent with the existing
`HH:MM` UTC comparisons in the current code. `now()` and `last_run_at` are
`timestamptz`. The occurrence is built in UTC and compared as an absolute
instant.

### Why one formula is enough

| Case                                                | Behaviour                                                                                                                                                               | Correct?        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Reliable 30-min cadence                             | `last_run ≈ now − 30min`; same devices as today's window                                                                                                                | ✓ no regression |
| Window crosses midnight (last run 23:50, now 00:43) | a 23:55 user → yesterday@23:55 > 23:50 ✓; a 00:30 user → today@00:30 > 23:50 ✓; a 22:00 user → yesterday@22:00 < 23:50, not due ✓                                       | ✓               |
| Outage > 24h                                        | every device's most-recent occurrence is after `last_run`, so each is selected **exactly once** (a single instant per device); the next run advances `last_run` past it | ✓ no duplicates |

The half-open boundary flips from today's `[start, end)` to `(last_run, now]`
(exclusive start, inclusive end). A device sitting exactly on a boundary instant
is negligible and not a concern.

## Components

### 1. `supabase/schema.sql` — `notify_state` singleton

```sql
CREATE TABLE IF NOT EXISTS notify_state (
  id          BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one row. Seeded with now() so the first run after deploy sees a tiny
-- window and does NOT mass-notify every device.
INSERT INTO notify_state (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE notify_state ENABLE ROW LEVEL SECURITY;
-- No policy: only the cron service-role key touches this table, and the service
-- role bypasses RLS.
```

The `CHECK (id)` plus `id` being the primary key guarantees the table can hold at
most one row (`id = TRUE`).

### 2. `supabase/schema.sql` — two RPCs

Both `SECURITY DEFINER, SET search_path = public`, matching `register_device`.
The occurrence math is written once and reused.

**`peek_due_notifications() → boolean`** (read-only; called by the guard):

```sql
CREATE OR REPLACE FUNCTION peek_due_notifications()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM devices d, notify_state s
    WHERE d.notify_at IS NOT NULL
      AND (
        (CASE
           WHEN d.notify_at <= (now() AT TIME ZONE 'UTC')::time
             THEN (now() AT TIME ZONE 'UTC')::date + d.notify_at
             ELSE (now() AT TIME ZONE 'UTC')::date - 1 + d.notify_at
         END) AT TIME ZONE 'UTC'
      ) > s.last_run_at
  );
$$;
```

**`claim_due_notifications() → setof (fcm_token text)`** (called by the job;
returns due tokens **and** advances `last_run_at` atomically):

```sql
CREATE OR REPLACE FUNCTION claim_due_notifications()
RETURNS TABLE (fcm_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now  timestamptz := now();
  v_last timestamptz;
BEGIN
  SELECT s.last_run_at INTO v_last
  FROM notify_state s
  WHERE s.id
  FOR UPDATE;

  RETURN QUERY
    SELECT d.fcm_token
    FROM devices d
    WHERE d.notify_at IS NOT NULL
      AND (
        (CASE
           WHEN d.notify_at <= (v_now AT TIME ZONE 'UTC')::time
             THEN (v_now AT TIME ZONE 'UTC')::date + d.notify_at
             ELSE (v_now AT TIME ZONE 'UTC')::date - 1 + d.notify_at
         END) AT TIME ZONE 'UTC'
      ) > v_last;

  UPDATE notify_state SET last_run_at = v_now WHERE id;
END;
$$;
```

`FOR UPDATE` plus the workflow's `concurrency: { group: notify,
cancel-in-progress: false }` serialise runs, so two claims can never overlap.

**`last_run_at` advancement semantics:**

- The guard returning _empty_ → job is **skipped** → `claim` is **not** called →
  `last_run_at` does **not** advance → the window grows until something is due.
  This is the catch-up mechanism.
- The guard returning _due_ (or failing open) → job runs → `claim` advances
  `last_run_at` to `v_now`. A spurious fail-open run on a truly empty window
  advances `last_run` but loses nothing, because nobody was due before `v_now`.

### 3. `cron/jobs/notify.ts` — shrinks to a thin RPC call

Removes the `notifyWindow` import, the window log line, and the `.from('devices')`
query. New shape (preserving the existing logger, error handling, and
`process.exit` pattern):

```ts
import { loadPulseConfig } from '../src/config';
import { buildClient, dispatchFcm } from '../src/notify';
import { getLogger } from '../src/logging';

async function main(): Promise<void> {
  loadPulseConfig();
  const log = getLogger('notify-cron');

  try {
    const db = buildClient();

    const { data, error } = await db.rpc('claim_due_notifications');
    if (error) {
      throw new Error(`Failed to claim due notifications: ${error.message}`);
    }

    const tokens = (data ?? []).map((d) => d.fcm_token as string);
    if (!tokens.length) {
      log.info('No devices due');
    } else {
      const { sent, total } = await dispatchFcm(tokens);
      log.info(`Sent ${sent}/${total} notifications`);
    }
  } catch (err) {
    log.error(`Unhandled error: ${String(err)}`);
    process.exit(1);
  }

  process.exit(0);
}

void main();
```

The doc-comment header is updated to describe the catch-up window model.

### 4. `.github/workflows/notify.yml` — guard swaps query for RPC

The guard `node -e` block now `POST`s to `/rest/v1/rpc/peek_due_notifications`
and sets `has=<bool>`, still **failing open** on any error:

```js
const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/peek_due_notifications`;
fetch(url, {
  method: 'POST',
  headers: {
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
})
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((due) => {
    console.log(`due: ${due}`);
    process.stdout.write(`has=${due === true}\n`);
  })
  .catch((e) => {
    console.log(`guard error (${e.message}) — failing open`);
    process.stdout.write('has=true\n');
  });
```

The `NOTIFY_WINDOW_START` / `NOTIFY_WINDOW_END` env vars are removed from the
`./.github/actions/run-cron-job` step. The schedule (`*/30 * * * *`),
`concurrency`, `timeout-minutes`, and the cost-floor comments are unchanged. The
guard step's purpose (skip checkout + npm on empty runs to stay at the 1-minute
billing floor) is preserved.

`.github/workflows/daily-digest.yml` is **unchanged**.

### 5. Deletions

- `cron/src/lib/notifyWindow.ts`
- its test (`cron/src/tests/notifyWindow.test.ts`)
- all `NOTIFY_WINDOW_*` references

## Data flow

```
GHA schedule fires (irregularly)
   │
   ▼
guard: POST peek_due_notifications()
   │  false → skip job, last_run NOT advanced, window grows
   │  true / error(fail-open) ↓
   ▼
checkout + npm + run jobs/notify.ts
   │
   ▼
claim_due_notifications()  ── FOR UPDATE on notify_state
   │   returns due fcm_tokens
   │   advances last_run_at = now()  (atomic, before dispatch)
   ▼
dispatchFcm(tokens) → log sent/total
```

## Error handling

- **Guard error** → fail open (`has=true`), job runs; a spurious run on an empty
  window advances `last_run` harmlessly.
- **`claim` RPC error** → `notify.ts` throws, logs, `process.exit(1)`;
  `last_run_at` not advanced (the `UPDATE` is in the same failed transaction);
  next run retries the same window.
- **Dispatch error** → `dispatchFcm` tolerates per-token failures and reports
  `sent/total`. A total FCM outage drops at most one window (at-most-once, by
  design); affected devices' next occurrence is tomorrow.
- **Empty result** → log "No devices due", exit 0.

## Testing (option a)

The date logic lives in SQL, which the repo cannot unit-test (Jest, no Postgres
in CI; convention is "integration needing live keys → `e2e/` manual runners").

1. **Unit tests** for the new thin `notify.ts` with a mocked Supabase client:
   - claims and dispatches the returned tokens,
   - empty result → no dispatch, logs "No devices due",
   - `rpc` error → throws / exits non-zero.
     Mirror existing `cron` test patterns and mocking style.

2. **`e2e/` runner** that seeds `notify_state` + `devices` against the real
   Supabase project and asserts `peek` / `claim` for the four key cases:
   normal cadence, midnight wrap, >24h outage, boundary. Run manually (needs the
   live service key), per repo strategy.

No pure-TS oracle of the SQL rule (rejected option b) — the SQL is the single
source of truth.

## Deployment

`supabase/schema.sql` is the canonical reference; the new table and two functions
must also be applied to the live Supabase project (via `apply_migration` / the
Supabase dashboard) before the updated workflow runs. The `notify_state` seed
row must exist (seeded with `now()`) so the first post-deploy run does not
mass-notify.

## Out of scope

- `daily-digest.ts` and the `notify_at = NULL` digest-time path.
- Any app / React Native changes (`notify_at` is still owned by the app's
  `updateNotifyTime`; no new columns).
- Per-device delivery tracking.

```

```
