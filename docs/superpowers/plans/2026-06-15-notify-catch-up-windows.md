# Notify Catch-Up Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `jobs/notify.ts`'s fixed 30-minute window with a `(last_run, now]` catch-up window backed by a Supabase singleton, so devices are never dropped when the GitHub Actions schedule fires irregularly.

**Architecture:** A one-row `notify_state` table stores `last_run_at`. Two `SECURITY DEFINER` Postgres RPCs hold the selection rule once: `peek_due_notifications()` (read-only, used by the workflow guard) and `claim_due_notifications()` (returns due FCM tokens **and** advances `last_run_at` atomically, used by the job). A new `sendDueNotifications()` in `cron/src/notify.ts` calls the claim RPC and dispatches; `jobs/notify.ts` becomes a thin wrapper. `notifyWindow.ts` and the `NOTIFY_WINDOW_*` plumbing are deleted.

**Tech Stack:** TypeScript (ts-node), Supabase (`@supabase/supabase-js` + PL/pgSQL RPCs), firebase-admin (FCM), Jest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-15-notify-catch-up-windows-design.md`

**Branch:** `feat/notify-catch-up-windows` (already checked out; the spec commit lives here).

---

## File Structure

| File                                  | Change  | Responsibility                                                                                                   |
| ------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `supabase/schema.sql`                 | Modify  | Canonical reference: add `notify_state` table + seed + `peek_due_notifications()` + `claim_due_notifications()`. |
| Live Supabase project                 | Migrate | Apply the same DDL via `apply_migration` so the deployed DB matches.                                             |
| `cron/src/notify.ts`                  | Modify  | Add exported `sendDueNotifications()` (claim RPC → dispatch).                                                    |
| `cron/src/tests/notify.test.ts`       | Modify  | Add `rpc` to the Supabase mock; unit-test `sendDueNotifications`.                                                |
| `cron/jobs/notify.ts`                 | Rewrite | Thin wrapper: `loadPulseConfig()` → `sendDueNotifications()` → log → exit.                                       |
| `.github/workflows/notify.yml`        | Modify  | Guard calls `peek_due_notifications` RPC; remove `NOTIFY_WINDOW_*` env.                                          |
| `cron/src/lib/notifyWindow.ts`        | Delete  | Window math no longer used.                                                                                      |
| `cron/src/tests/notifyWindow.test.ts` | Delete  | Tests the deleted module.                                                                                        |
| `cron/e2e/notifyWindows.ts`           | Create  | Manual runner asserting `peek`/`claim` against a real Supabase project for the 4 key cases.                      |

---

## Task 1: Add the `notify_state` singleton to `supabase/schema.sql`

**Files:**

- Modify: `supabase/schema.sql` (append after the `digests` block, before any trailing content)

- [ ] **Step 1: Add the table + seed to `schema.sql`**

Append this block to `supabase/schema.sql`:

```sql
-- ============================================================
-- notify_state
-- Single-row store of the last time jobs/notify.ts processed a window.
-- jobs/notify.ts notifies devices whose notify_at fell in (last_run_at, now],
-- so no device is dropped when the GitHub Actions schedule fires irregularly.
-- Seeded with now() so the first run after deploy sees a tiny window and does
-- NOT mass-notify every device. Only the cron service-role key touches this
-- table; the service role bypasses RLS, so no policy is defined.
-- ============================================================
CREATE TABLE IF NOT EXISTS notify_state (
  id          BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one row (id = TRUE); CHECK (id) + the PK forbid a second row.
INSERT INTO notify_state (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE notify_state ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Verify the SQL parses (lint-by-eye)**

Re-read the appended block. Confirm: `CHECK (id)` present, `DEFAULT now()` on `last_run_at`, seed `INSERT ... ON CONFLICT (id) DO NOTHING`, `ENABLE ROW LEVEL SECURITY`. No trailing syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): add notify_state singleton for catch-up windows"
```

---

## Task 2: Add the two RPCs to `supabase/schema.sql`

**Files:**

- Modify: `supabase/schema.sql` (append after the `notify_state` table block)

- [ ] **Step 1: Add `peek_due_notifications()` to `schema.sql`**

Append:

```sql
-- peek_due_notifications — read-only "is any device due since last_run_at?".
-- Called by the .github/workflows/notify.yml guard step to skip checkout+npm on
-- empty windows. A device is due iff the most recent occurrence of its notify_at
-- (today if it has already passed in UTC, else yesterday) is later than
-- last_run_at. notify_at is a UTC time-of-day, matching the rest of the cron.
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

GRANT EXECUTE ON FUNCTION peek_due_notifications() TO service_role;
```

- [ ] **Step 2: Add `claim_due_notifications()` to `schema.sql`**

Append:

```sql
-- claim_due_notifications — returns the FCM tokens of all due devices AND
-- advances last_run_at to now() atomically (FOR UPDATE serialises with the
-- workflow's concurrency group). Advancing before dispatch gives at-most-once
-- delivery, which is preferred over double-notify spam. Called by jobs/notify.ts.
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

GRANT EXECUTE ON FUNCTION claim_due_notifications() TO service_role;
```

- [ ] **Step 3: Verify by eye**

Confirm both functions are `SECURITY DEFINER` with `SET search_path = public` (matching `register_device`), `claim` uses `FOR UPDATE` and the `UPDATE ... WHERE id` advance is the **last** statement, and the occurrence `CASE` is identical in both functions.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): add peek/claim due-notification RPCs"
```

---

## Task 3: Apply the migration to the live Supabase project

**Files:** none (uses the Supabase MCP tool against the live project).

> ⚠️ This mutates the live Supabase database. The DDL is additive (new table + new functions) and idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`), so re-running is safe. Nothing existing is dropped or altered.

- [ ] **Step 1: Apply the migration**

Call `mcp__supabase__apply_migration` with:

- `name`: `notify_catch_up_windows`
- `query`: the **combined** SQL from Task 1 Step 1 + Task 2 Step 1 + Task 2 Step 2 (the `notify_state` table + seed + `ENABLE ROW LEVEL SECURITY`, then both `CREATE OR REPLACE FUNCTION ... GRANT` blocks), concatenated in that order.

- [ ] **Step 2: Smoke-test the table and seed**

Call `mcp__supabase__execute_sql` with:

```sql
SELECT id, last_run_at FROM notify_state;
```

Expected: exactly one row, `id = true`, `last_run_at` ≈ now (within seconds).

- [ ] **Step 3: Smoke-test the read-only RPC**

Call `mcp__supabase__execute_sql` with:

```sql
SELECT peek_due_notifications();
```

Expected: returns `true` or `false` without error (value depends on current devices; correctness is asserted in Task 7). Do **not** call `claim_due_notifications()` here — it would advance `last_run_at`.

---

## Task 4: Add `sendDueNotifications()` to `cron/src/notify.ts` (TDD)

**Files:**

- Modify: `cron/src/tests/notify.test.ts` (add `rpc` to mock; new `describe`)
- Modify: `cron/src/notify.ts` (new exported function)

- [ ] **Step 1: Add `rpc` to the Supabase mock**

In `cron/src/tests/notify.test.ts`, extend the `mockSupabase` object (currently lines ~11-18) so it includes an `rpc` mock:

```ts
const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  lt: jest.fn().mockResolvedValue({ error: null }),
  upsert: jest.fn().mockResolvedValue({ error: null }),
  select: jest.fn().mockResolvedValue({ data: [], error: null }),
  in: jest.fn().mockResolvedValue({ error: null }),
  rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
};
```

- [ ] **Step 2: Import the new function and write the failing tests**

Update the import line at the top of `cron/src/tests/notify.test.ts`:

```ts
import {
  persistDigests,
  persistGlobalDigest,
  dispatchFcm,
  sendNotifications,
  sendDueNotifications,
} from '../notify';
```

Append this `describe` block at the end of `cron/src/tests/notify.test.ts`:

```ts
// ── sendDueNotifications ─────────────────────────────────────────────────────────

describe('sendDueNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.from.mockReturnThis();
    mockSupabase.in.mockResolvedValue({ error: null });
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SECRET_KEY = 'test-key';
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';
  });

  it('claims due tokens via the claim_due_notifications RPC and dispatches them', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: [{ fcm_token: 'tok-a' }, { fcm_token: 'tok-b' }],
      error: null,
    });
    mockSendEachForMulticast.mockResolvedValueOnce({
      successCount: 2,
      responses: [{ error: null }, { error: null }],
    });

    const result = await sendDueNotifications();

    expect(mockSupabase.rpc).toHaveBeenCalledWith('claim_due_notifications');
    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['tok-a', 'tok-b'] }),
    );
    expect(result).toEqual({ sent: 2, total: 2 });
  });

  it('skips dispatch and returns zero when no devices are due', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const result = await sendDueNotifications();

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, total: 0 });
  });

  it('treats null RPC data as no devices due', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await sendDueNotifications();

    expect(mockSendEachForMulticast).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, total: 0 });
  });

  it('throws when the claim RPC returns an error', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });

    await expect(sendDueNotifications()).rejects.toThrow(
      'Failed to claim due notifications: rpc failed',
    );
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd cron && npx jest src/tests/notify.test.ts -t sendDueNotifications`
Expected: FAIL — `sendDueNotifications` is not exported / `is not a function`.

- [ ] **Step 4: Implement `sendDueNotifications()` in `cron/src/notify.ts`**

Add this exported function to `cron/src/notify.ts` (place it just above `sendNotifications`, near the other dispatch helpers):

```ts
/**
 * Notify devices whose notify_at fell in (last_run_at, now]. The
 * claim_due_notifications RPC returns the due FCM tokens and advances
 * last_run_at atomically, so unreliable cron firing never drops a device.
 * Used by jobs/notify.ts.
 */
export async function sendDueNotifications(): Promise<{ sent: number; total: number }> {
  const log = getLogger('notify');
  const db = buildClient();

  const { data, error } = await db.rpc('claim_due_notifications');
  if (error) {
    throw new Error(`Failed to claim due notifications: ${error.message}`);
  }

  const tokens = ((data ?? []) as Array<{ fcm_token: string }>).map((d) => d.fcm_token);
  if (tokens.length === 0) {
    log.info('No devices due');
    return { sent: 0, total: 0 };
  }

  return dispatchFcm(tokens);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd cron && npx jest src/tests/notify.test.ts -t sendDueNotifications`
Expected: PASS (4 passing).

- [ ] **Step 6: Run the full notify suite to confirm no regressions**

Run: `cd cron && npx jest src/tests/notify.test.ts`
Expected: PASS (all existing + 4 new).

- [ ] **Step 7: Commit**

```bash
git add cron/src/notify.ts cron/src/tests/notify.test.ts
git commit -m "feat(cron): add sendDueNotifications backed by claim RPC"
```

---

## Task 5: Rewrite `cron/jobs/notify.ts` as a thin wrapper

**Files:**

- Rewrite: `cron/jobs/notify.ts`

- [ ] **Step 1: Replace the file contents**

Overwrite `cron/jobs/notify.ts` with:

```ts
import { loadPulseConfig } from '../src/config';
import { sendDueNotifications } from '../src/notify';
import { getLogger } from '../src/logging';

/**
 * GitHub Actions cron job (.github/workflows/notify.yml) — notify devices whose
 * notify_at fell in (last_run_at, now]. The catch-up window means a device is
 * never dropped when the schedule fires irregularly; in the reliable every-30-min
 * case it matches the old fixed-window behaviour. Devices with notify_at = NULL
 * are handled by jobs/daily-digest.ts instead.
 *
 * Run from cron/: `npx ts-node -r tsconfig-paths/register jobs/notify.ts`
 */
async function main(): Promise<void> {
  loadPulseConfig();

  const log = getLogger('notify-cron');

  try {
    const { sent, total } = await sendDueNotifications();
    log.info(`Sent ${sent}/${total} notifications`);
  } catch (err) {
    log.error(`Unhandled error: ${String(err)}`);
    process.exit(1);
  }

  // firebase-admin / supabase keep sockets open — without an explicit exit the
  // Actions job would hang until its timeout after the work is done.
  process.exit(0);
}

void main();
```

- [ ] **Step 2: Typecheck the cron package**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors. (`notifyWindow` is still present at this point; it is deleted in Task 7. The rewritten `notify.ts` no longer imports it, which is fine.)

- [ ] **Step 3: Commit**

```bash
git add cron/jobs/notify.ts
git commit -m "refactor(cron): notify.ts delegates to sendDueNotifications"
```

---

## Task 6: Update the `notify.yml` guard to use the RPC

**Files:**

- Modify: `.github/workflows/notify.yml`

- [ ] **Step 1: Replace the guard step**

In `.github/workflows/notify.yml`, replace the entire `- name: Check window for devices` step (currently the `id: guard` block) with:

```yaml
# Most runs have no due devices. Ask Supabase first (no checkout/install
# needed) via the peek RPC and skip the heavy steps when nothing is due.
# The RPC encapsulates the (last_run_at, now] selection rule shared with
# the job. Fails OPEN: any guard error runs the job.
- name: Check for due devices
  id: guard
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SECRET_KEY: ${{ secrets.SUPABASE_SECRET_KEY }}
  run: |
    node -e '
      const url = `${process.env.SUPABASE_URL}/rest/v1/rpc/peek_due_notifications`;
      fetch(url, {
        method: "POST",
        headers: {
          apikey: process.env.SUPABASE_SECRET_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((due) => {
          console.log(`due: ${due}`);
          process.stdout.write(`has=${due === true}\n`);
        })
        .catch((e) => {
          console.log(`guard error (${e.message}) — failing open`);
          process.stdout.write("has=true\n");
        });
    ' | tee guard.out
    grep "^has=" guard.out >> "$GITHUB_OUTPUT" || echo "has=true" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 2: Remove the `NOTIFY_WINDOW_*` env from the job step**

In the same file, in the `- uses: ./.github/actions/run-cron-job` step's `env:` block, delete these two lines:

```yaml
NOTIFY_WINDOW_START: ${{ steps.guard.outputs.start }}
NOTIFY_WINDOW_END: ${{ steps.guard.outputs.end }}
```

The remaining `env:` keys (`SUPABASE_*`, `FIREBASE_*`) and `with: { job: jobs/notify.ts }` are unchanged.

- [ ] **Step 3: Verify by eye**

Confirm: the guard no longer emits `start=`/`end=` lines; the `if: steps.guard.outputs.has == 'true'` conditions on `checkout` and `run-cron-job` are unchanged; the schedule (`*/30 * * * *`), `concurrency`, and `timeout-minutes` are untouched. `.github/workflows/daily-digest.yml` is not modified.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/notify.yml
git commit -m "feat(ci): notify guard uses peek_due_notifications RPC"
```

---

## Task 7: Delete `notifyWindow.ts` and its test

**Files:**

- Delete: `cron/src/lib/notifyWindow.ts`
- Delete: `cron/src/tests/notifyWindow.test.ts`

- [ ] **Step 1: Confirm nothing else imports `notifyWindow`**

Use the Grep tool (or `rg`) to search the repo for `notifyWindow|NOTIFY_WINDOW`.
Expected: matches only in the two files being deleted (`cron/src/lib/notifyWindow.ts`, `cron/src/tests/notifyWindow.test.ts`). If `cron/jobs/notify.ts` or `.github/workflows/notify.yml` still reference either, Tasks 5/6 were not applied — fix those first.

- [ ] **Step 2: Delete both files**

```bash
git rm cron/src/lib/notifyWindow.ts cron/src/tests/notifyWindow.test.ts
```

- [ ] **Step 3: Typecheck and run the full cron suite**

Run: `cd cron && npx tsc --noEmit && npx jest`
Expected: no type errors; all tests pass; no reference to the deleted module.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(cron): remove unused notifyWindow window logic"
```

---

## Task 8: Add the `e2e/notifyWindows.ts` manual runner

**Files:**

- Create: `cron/e2e/notifyWindows.ts`

> This runner needs live `SUPABASE_URL` / `SUPABASE_SECRET_KEY` (loaded via `../src/bootstrap`, matching the other `e2e/` runners). It mutates the project: it snapshots and restores `notify_state.last_run_at`, and inserts then deletes device rows keyed by a unique `e2e-notify-` token prefix. Run against a dev project when possible.

- [ ] **Step 1: Create the runner**

Create `cron/e2e/notifyWindows.ts`:

```ts
import '../src/bootstrap';
import { loadPulseConfig } from '../src/config';
import { getLogger } from '../src/logging';
import { buildClient } from '../src/notify';

const log = getLogger('e2e:notifyWindows');

// Fixed UUIDs + token prefix so cleanup can target exactly these rows.
const PREFIX = 'e2e-notify-';
const DEV_A = '00000000-0000-4000-8000-0000000000a1'; // notify_at in-window
const DEV_B = '00000000-0000-4000-8000-0000000000b2'; // notify_at out-of-window

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC HH:MM:SS string `offsetMin` minutes from `base`. */
function utcTime(base: Date, offsetMin: number): string {
  const d = new Date(base.getTime() + offsetMin * 60_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

async function main(): Promise<void> {
  loadPulseConfig();
  const db = buildClient();

  // Snapshot last_run_at so we can restore it after the destructive claim test.
  const { data: snap, error: snapErr } = await db
    .from('notify_state')
    .select('last_run_at')
    .eq('id', true)
    .single();
  if (snapErr) throw new Error(`Failed to read notify_state: ${snapErr.message}`);
  const savedLastRun = snap!.last_run_at as string;
  log.info(`Saved last_run_at = ${savedLastRun}`);

  let failures = 0;
  const check = (name: string, ok: boolean) => {
    log.info(`${ok ? 'PASS' : 'FAIL'} — ${name}`);
    if (!ok) failures += 1;
  };

  try {
    const now = new Date();

    // Device A: notify_at 5 min ago (inside a (last_run, now] window that
    // starts 30 min ago). Device B: notify_at 5 min in the future (outside).
    await db.from('devices').upsert([
      { id: DEV_A, fcm_token: `${PREFIX}a`, notify_at: utcTime(now, -5) },
      { id: DEV_B, fcm_token: `${PREFIX}b`, notify_at: utcTime(now, +5) },
    ]);

    // Set last_run_at to 30 min ago: A's time is inside (last_run, now], B's is not.
    await db
      .from('notify_state')
      .update({ last_run_at: new Date(now.getTime() - 30 * 60_000).toISOString() })
      .eq('id', true);

    // peek must report due (A qualifies).
    const { data: peek, error: peekErr } = await db.rpc('peek_due_notifications');
    if (peekErr) throw new Error(`peek failed: ${peekErr.message}`);
    check('normal window: peek returns true when a device is due', peek === true);

    // claim returns A's token (not B's) and advances last_run_at.
    const { data: claimed, error: claimErr } = await db.rpc('claim_due_notifications');
    if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);
    const tokens = ((claimed ?? []) as Array<{ fcm_token: string }>).map((r) => r.fcm_token);
    check('normal window: claim returns the in-window device', tokens.includes(`${PREFIX}a`));
    check('normal window: claim excludes the out-of-window device', !tokens.includes(`${PREFIX}b`));

    // After claim, last_run_at advanced to ~now, so the same A is no longer due.
    const { data: peek2, error: peek2Err } = await db.rpc('peek_due_notifications');
    if (peek2Err) throw new Error(`peek2 failed: ${peek2Err.message}`);
    check('idempotency: peek returns false immediately after claim', peek2 === false);

    // >24h outage: last_run far in the past → every device is due once.
    await db
      .from('notify_state')
      .update({ last_run_at: new Date(now.getTime() - 48 * 3600 * 1000).toISOString() })
      .eq('id', true);
    const { data: claimedAll, error: allErr } = await db.rpc('claim_due_notifications');
    if (allErr) throw new Error(`claim (outage) failed: ${allErr.message}`);
    const allTokens = ((claimedAll ?? []) as Array<{ fcm_token: string }>).map((r) => r.fcm_token);
    check(
      '>24h outage: both test devices are claimed',
      allTokens.includes(`${PREFIX}a`) && allTokens.includes(`${PREFIX}b`),
    );
  } finally {
    // Cleanup: remove test devices and restore the original last_run_at.
    await db.from('devices').delete().in('id', [DEV_A, DEV_B]);
    await db.from('notify_state').update({ last_run_at: savedLastRun }).eq('id', true);
    log.info(`Restored last_run_at = ${savedLastRun}; removed test devices`);
  }

  if (failures > 0) {
    log.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  log.info('All notify-window checks passed');
  process.exit(0);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the e2e runner against a live project (manual)**

Run: `cd cron && npx ts-node -r tsconfig-paths/register e2e/notifyWindows.ts`
Expected: `PASS` for every check, then `All notify-window checks passed`, exit 0. `last_run_at` is restored and the `e2e-notify-*` device rows are deleted.

> If run against the production project, note this momentarily inserts two devices with placeholder FCM tokens. They are deleted in the `finally` block and never receive a push (the runner never calls `dispatchFcm`).

- [ ] **Step 4: Commit**

```bash
git add cron/e2e/notifyWindows.ts
git commit -m "test(cron): e2e runner for peek/claim notify windows"
```

---

## Task 9: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck, lint, test, format**

Run each and confirm clean:

```bash
cd cron && npx tsc --noEmit
cd cron && npx eslint --ext .ts src
cd cron && npm test
```

```bash
# from repo root
npm run format:check
```

Expected: typecheck clean; eslint clean; Jest green (notify suite includes the new `sendDueNotifications` tests; no `notifyWindow` suite remains); format check passes. If `format:check` flags the new/edited files, run `npm run format` and amend the relevant commit.

- [ ] **Step 2: Confirm the deployed DB matches**

Call `mcp__supabase__execute_sql` with:

```sql
SELECT
  to_regclass('public.notify_state') IS NOT NULL                         AS has_table,
  to_regprocedure('public.peek_due_notifications()') IS NOT NULL         AS has_peek,
  to_regprocedure('public.claim_due_notifications()') IS NOT NULL        AS has_claim;
```

Expected: all three columns `true`.

- [ ] **Step 3: Push the branch and open a PR to `develop`**

Per `CLAUDE.md`: changes touch notifications + CI, so run `/code-review` and `/security-review` before opening. Then:

```bash
git push -u origin feat/notify-catch-up-windows
```

Open a PR targeting **`develop`** (confirm the base branch). Include in the body: the spec link, the at-most-once delivery trade-off, and a note that the migration was already applied to the live project via `apply_migration`.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** `notify_state` table (Task 1), `peek`/`claim` RPCs (Task 2), live migration + seed (Task 3), thin `notify.ts` via `sendDueNotifications` (Tasks 4–5), guard RPC swap + `NOTIFY_WINDOW_*` removal (Task 6), `notifyWindow.ts` + test deletion (Task 7), option-(a) tests = mocked unit tests (Task 4) + `e2e/` runner (Task 8). `daily-digest.yml`/`daily-digest.ts` deliberately untouched.
- **Type consistency:** the RPC name `claim_due_notifications` and the `{ fcm_token: string }[]` row shape are identical across `sendDueNotifications` (Task 4), its tests (Task 4), and the e2e runner (Task 8). `peek_due_notifications` returns `boolean`, consumed as `due === true` in the guard (Task 6) and the runner (Task 8).
- **At-most-once:** `claim` advances `last_run_at` as its final statement, before dispatch — matches the spec's stated trade-off.
