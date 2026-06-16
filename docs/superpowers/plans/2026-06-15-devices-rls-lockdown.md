# Devices Table RLS Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three open `USING(true)` RLS policies on `devices` with a deny-all table whose only client write surface is `SECURITY DEFINER` RPCs, and delete the now-dead `/api/account` endpoint.

**Architecture:** Keep RLS enabled on `devices` but drop every policy, so direct anon/authenticated access is denied. Add two definer RPCs — `update_notify_time` and `link_device_to_user` (which derives `user_id` from `auth.uid()`) — alongside the existing `register_device`. The React Native app switches its two direct table UPDATEs to these RPCs.

**Tech Stack:** Postgres/Supabase (RLS + plpgsql RPCs), TypeScript, React Native (Expo), Jest + ts-jest. Branch: `feat/devices-rls-lockdown` (already created).

**Spec:** `docs/superpowers/specs/2026-06-15-devices-rls-lockdown-design.md`

---

## File Structure

| File                                          | Responsibility              | Change                                                                 |
| --------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `supabase/schema.sql`                         | Schema source-of-truth      | Drop 3 policies; add `update_notify_time` + `link_device_to_user` RPCs |
| (live Supabase project)                       | Running database            | Apply the same migration                                               |
| `app/src/notifications/devices.ts`            | App device write helpers    | `updateNotifyTime` + `linkDeviceToUser` → RPC calls                    |
| `app/src/hooks/useDeviceRegistration.ts`      | Registration lifecycle hook | Update `linkDeviceToUser` call site (drop `userId` arg)                |
| `app/src/tests/notifications/devices.test.ts` | App write-helper tests      | Rewrite mocks to RPC-based                                             |
| `cron/api/account.ts`                         | Dead serverless endpoint    | Delete                                                                 |
| `cron/src/tests/account.test.ts`              | Its test                    | Delete                                                                 |

---

## Task 1: Database — definer RPCs + drop open policies

**Files:**

- Modify: `supabase/schema.sql:29-39` (replace the 3 policies) and after `:74` (add 2 RPCs)
- Apply: live Supabase project (via `mcp__supabase.apply_migration`)

- [ ] **Step 1: Replace the open policies in `supabase/schema.sql`**

Replace lines 29–39 (the three `CREATE POLICY` blocks and their comment, **keep** line 27 `ALTER TABLE devices ENABLE ROW LEVEL SECURITY;`) with:

```sql
-- All client writes go through SECURITY DEFINER RPCs (register_device,
-- update_notify_time, link_device_to_user); the cron reads via the service-role
-- key, which bypasses RLS. No open policy is defined, so RLS denies every direct
-- anon/authenticated SELECT/INSERT/UPDATE — closing publishable-key token
-- harvesting and blind tampering. DROP IF EXISTS keeps re-applying this file
-- idempotent against a database that still carries the old open policies.
DROP POLICY IF EXISTS "device self-select"   ON devices;
DROP POLICY IF EXISTS "device self-register" ON devices;
DROP POLICY IF EXISTS "device self-update"   ON devices;
```

- [ ] **Step 2: Add the two RPCs after the `register_device` grant**

Immediately after `supabase/schema.sql:74` (`GRANT EXECUTE ON FUNCTION register_device(uuid, text, uuid) TO anon, authenticated, service_role;`), insert:

```sql

-- update_notify_time — the only path for the app to change a device's notify_at.
-- Definer so it works with the publishable key against the now-policyless table.
-- Keyed by the per-install device UUID (an unguessable capability). Returns FOUND
-- so the app can warn when the row does not exist yet (registration not finished).
CREATE OR REPLACE FUNCTION update_notify_time(p_id uuid, p_notify_at time)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE devices
    SET notify_at = p_notify_at, updated_at = now()
    WHERE id = p_id;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION update_notify_time(uuid, time) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_notify_time(uuid, time) TO anon, authenticated, service_role;

-- link_device_to_user — stamps the auth link onto a device row. user_id is NOT a
-- parameter: it is derived from the caller's JWT via auth.uid(), so a device can
-- only ever be linked to the authenticated caller's own identity. Granted to
-- authenticated only (the app calls this exclusively post-login). Returns FOUND so
-- the app's retry can wait for the row to appear.
CREATE OR REPLACE FUNCTION link_device_to_user(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'link_device_to_user requires an authenticated user';
  END IF;
  UPDATE devices
    SET user_id = v_uid, updated_at = now()
    WHERE id = p_id;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION link_device_to_user(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION link_device_to_user(uuid) TO authenticated, service_role;
```

- [ ] **Step 3: Apply the migration to the live project**

Use the Supabase MCP tool (project is the live Pulse project). Call `mcp__supabase.apply_migration` with:

- `name`: `devices_rls_lockdown`
- `query`: the exact SQL from Step 1 (the three `DROP POLICY` lines) **followed by** the two `CREATE OR REPLACE FUNCTION` + `REVOKE`/`GRANT` blocks from Step 2.

Expected: success, no error.

- [ ] **Step 4: Verify the lockdown with role-scoped SQL**

Run via `mcp__supabase.execute_sql`, one statement group at a time:

```sql
-- (a) anon cannot read the table (harvest closed)
SET ROLE anon;
SELECT count(*) AS visible_rows FROM devices;
RESET ROLE;
```

Expected: `visible_rows = 0` (RLS hides all rows from anon).

```sql
-- (b) anon CAN register + set notify_at via the RPCs
SET ROLE anon;
SELECT register_device('00000000-0000-4000-8000-0000000000c3', 'rls-test-token', NULL);
SELECT update_notify_time('00000000-0000-4000-8000-0000000000c3', '09:00') AS updated;
RESET ROLE;
```

Expected: `register_device` returns void (no error); `update_notify_time` returns `updated = true`.

```sql
-- (c) anon CANNOT call link (no auth.uid) and CANNOT even execute it (not granted)
SET ROLE anon;
SELECT link_device_to_user('00000000-0000-4000-8000-0000000000c3');
RESET ROLE;
```

Expected: an error — either `permission denied for function link_device_to_user` (not granted to anon) or the `requires an authenticated user` exception. Either proves anon cannot link.

```sql
-- (d) cleanup the test row
DELETE FROM devices WHERE id = '00000000-0000-4000-8000-0000000000c3';
```

Expected: 1 row deleted.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(db): lock down devices RLS behind definer RPCs"
```

---

## Task 2: App — `updateNotifyTime` via RPC

**Files:**

- Modify: `app/src/notifications/devices.ts:95-118` (`updateNotifyTime`)
- Test: `app/src/tests/notifications/devices.test.ts` (rewrite the mock harness + `updateNotifyTime` block; the `upsertDevice` block continues to pass)

- [ ] **Step 1: Rewrite the test harness + `upsertDevice`/`updateNotifyTime` blocks**

Replace the top of `app/src/tests/notifications/devices.test.ts` (lines 1–80, i.e. imports through the end of the `upsertDevice` describe) with the RPC-based harness below, then replace the `updateNotifyTime` describe (lines 153–204) with the new block in Step-2-of-this-file. Full new harness + `upsertDevice`:

```ts
import { storage } from '../../storage/mmkv';
import { getSupabase } from '../../supabase/client';
import { TOKEN_KEY } from '../../notifications/keys';
import { upsertDevice, linkDeviceToUser, updateNotifyTime } from '../../notifications/devices';

jest.mock('../../supabase/client', () => ({ getSupabase: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

interface FakeClient {
  rpc: jest.Mock;
  from: jest.Mock;
}

// Every write now flows through client.rpc(name, args). `from` exists only so
// tests can assert it is NEVER called (no direct table access remains).
function makeClient(): FakeClient {
  return {
    rpc: jest.fn().mockResolvedValue({ data: true, error: null }),
    from: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
});

describe('upsertDevice', () => {
  it('registers via the register_device RPC with p_id + p_token', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    expect(client.rpc).toHaveBeenCalledWith('register_device', {
      p_id: 'dev-1',
      p_token: 'tok-1',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('omits p_user_id — login links the user separately', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('p_user_id' in args).toBe(false);
  });

  it('never writes notify_at — registration does not own it', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('notify_at' in args).toBe(false);
    expect('p_notify_at' in args).toBe(false);
  });

  it('returns false when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' })).resolves.toBe(false);
  });

  it('returns false and does not throw when the RPC returns an error', async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' })).resolves.toBe(false);
  });
});

describe('updateNotifyTime', () => {
  it('skips when no FCM token is cached (device not yet registered)', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('calls update_notify_time with p_id + p_notify_at and never touches the table', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.rpc).toHaveBeenCalledWith('update_notify_time', {
      p_id: 'dev-1',
      p_notify_at: '09:00',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('forwards a null notify_at (clearing the time)', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', null);
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('p_notify_at' in args).toBe(true);
    expect(args.p_notify_at).toBeNull();
  });

  it('resolves when the RPC reports no row updated (data false)', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: false, error: null });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(updateNotifyTime('dev-1', '09:00')).resolves.toBeUndefined();
  });

  it('resolves without throwing when the RPC errors', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    mockGetSupabase.mockReturnValue(client as never);
    await expect(updateNotifyTime('dev-1', '09:00')).resolves.toBeUndefined();
  });
});
```

> Note: the `linkDeviceToUser` describe block (old lines 82–151) is replaced in Task 3. After this step that block still references the old two-arg signature and will fail to compile — that is expected; Task 3 fixes it. To keep this task independently green, **also** apply Task 3's test edit before running. If executing strictly one task at a time, run the targeted command below which only runs the rewritten blocks.

- [ ] **Step 2: Run the updateNotifyTime tests to verify they fail**

Run: `cd app && npx jest src/tests/notifications/devices.test.ts -t "updateNotifyTime"`
Expected: FAIL — `updateNotifyTime` still calls `.from('devices')`, so `client.rpc` was not called / `client.from` was.

- [ ] **Step 3: Rewrite `updateNotifyTime` in `app/src/notifications/devices.ts`**

Replace the body of `updateNotifyTime` (lines 95–118) with:

```ts
export async function updateNotifyTime(deviceId: string, notifyAt: string | null): Promise<void> {
  const cachedToken = storage.getString(TOKEN_KEY) ?? null;
  if (!cachedToken) {
    log.debug('updateNotifyTime: no cached token — device not yet registered, skipping');
    return;
  }
  const supabase = getSupabase();
  if (!supabase) return;
  log.info(`updating notify_at → ${notifyAt ?? 'null'} for device ${deviceId.slice(0, 8)}…`);
  const { data, error } = await supabase.rpc('update_notify_time', {
    p_id: deviceId,
    p_notify_at: notifyAt,
  });
  if (error) {
    log.warn(`updateNotifyTime failed: ${error.message}`);
  } else if (data !== true) {
    log.warn(
      `updateNotifyTime: no device row for ${deviceId.slice(0, 8)}… — notify_at not saved (device may not have registered yet)`,
    );
  } else {
    log.debug(`notify_at updated for device ${deviceId.slice(0, 8)}…`);
  }
}
```

- [ ] **Step 4: Run the updateNotifyTime tests to verify they pass**

Run: `cd app && npx jest src/tests/notifications/devices.test.ts -t "updateNotifyTime"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/notifications/devices.ts app/src/tests/notifications/devices.test.ts
git commit -m "feat(app): updateNotifyTime writes via update_notify_time RPC"
```

---

## Task 3: App — `linkDeviceToUser` via RPC + call site

**Files:**

- Modify: `app/src/notifications/devices.ts:49-81` (`linkDeviceToUser`)
- Modify: `app/src/hooks/useDeviceRegistration.ts:97` (call site)
- Test: `app/src/tests/notifications/devices.test.ts` (replace the `linkDeviceToUser` describe block)

- [ ] **Step 1: Replace the `linkDeviceToUser` describe block in the test file**

Replace the old `linkDeviceToUser` describe (lines 82–151) with:

```ts
describe('linkDeviceToUser', () => {
  it('links via link_device_to_user with p_id and never touches the table', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    expect(client.rpc).toHaveBeenCalledWith('link_device_to_user', { p_id: 'dev-1' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('does not pass a user_id — it is derived server-side from the JWT', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    const args = client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('user_id' in args).toBe(false);
    expect('p_user_id' in args).toBe(false);
  });

  it('no-ops when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(linkDeviceToUser('dev-1')).resolves.toBeUndefined();
  });

  it('does not retry on a Supabase error — exits immediately', async () => {
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the first attempt when data is true', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1');
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('retries on a false (0-row) result, succeeding on the last attempt', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    client.rpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValue({ data: true, error: null });
    mockGetSupabase.mockReturnValue(client as never);
    const promise = linkDeviceToUser('dev-1');
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;
    expect(client.rpc).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });

  it('stops after 3 attempts when the row never appears (always false)', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    client.rpc.mockResolvedValue({ data: false, error: null });
    mockGetSupabase.mockReturnValue(client as never);
    const promise = linkDeviceToUser('dev-1');
    await jest.advanceTimersByTimeAsync(2000);
    await jest.advanceTimersByTimeAsync(2000);
    await promise;
    expect(client.rpc).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the linkDeviceToUser tests to verify they fail**

Run: `cd app && npx jest src/tests/notifications/devices.test.ts -t "linkDeviceToUser"`
Expected: FAIL — current `linkDeviceToUser` takes two args and calls `.from('devices')`, so `client.rpc` is not called with `link_device_to_user`.

- [ ] **Step 3: Rewrite `linkDeviceToUser` in `app/src/notifications/devices.ts`**

Replace the body of `linkDeviceToUser` (lines 49–81) with:

```ts
/**
 * Associate this device with the signed-in user via the link_device_to_user RPC.
 * The RPC derives user_id from auth.uid() (the caller's JWT), so no user id is
 * passed and a device can only be linked to the caller's own identity. Retries up
 * to 3 times on a false result (the device row may not exist yet if registration
 * is still in-flight). Gives up immediately on a DB error. No-op when unconfigured.
 */
export async function linkDeviceToUser(deviceId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, error } = await supabase.rpc('link_device_to_user', { p_id: deviceId });
    if (error) {
      log.warn(`linkDeviceToUser failed: ${error.message}`);
      return;
    }
    if (data === true) {
      log.info(`device ${deviceId.slice(0, 8)}… linked`);
      return;
    }
    if (attempt < MAX_ATTEMPTS) {
      log.debug(
        `linkDeviceToUser: 0-row (attempt ${attempt}/${MAX_ATTEMPTS}) — device row not yet present, retrying in ${RETRY_DELAY_MS}ms`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  log.warn(
    `linkDeviceToUser: no device row for ${deviceId.slice(0, 8)}… after ${MAX_ATTEMPTS} attempts — not linked (device may not have registered yet)`,
  );
}
```

- [ ] **Step 4: Update the call site in `app/src/hooks/useDeviceRegistration.ts:97`**

Change:

```ts
    linkDeviceToUser(deviceId, userId).catch((e: unknown) =>
```

to:

```ts
    linkDeviceToUser(deviceId).catch((e: unknown) =>
```

The `if (!userId || !deviceId) return;` gate on line 96 stays unchanged — `userId` still gates _whether_ to link (a session must exist), it is just no longer passed.

- [ ] **Step 5: Run the full devices test file to verify it passes**

Run: `cd app && npx jest src/tests/notifications/devices.test.ts`
Expected: PASS — all `upsertDevice`, `updateNotifyTime`, and `linkDeviceToUser` cases green.

- [ ] **Step 6: Commit**

```bash
git add app/src/notifications/devices.ts app/src/hooks/useDeviceRegistration.ts app/src/tests/notifications/devices.test.ts
git commit -m "feat(app): linkDeviceToUser uses link_device_to_user RPC (JWT-derived user)"
```

---

## Task 4: Delete the dead `/api/account` endpoint

**Files:**

- Delete: `cron/api/account.ts`
- Delete: `cron/src/tests/account.test.ts`

- [ ] **Step 1: Confirm nothing references the endpoint**

Run (Grep tool, or): `cd cron && npx tsc --noEmit` after deletion in Step 2. First, sanity-check there is no import of the route:

Run: `git grep -n "api/account" -- ':!docs'`
Expected: no matches in `app/` or `cron/src` source (only this plan / spec docs, which are excluded). If any source match appears, STOP and reassess.

- [ ] **Step 2: Delete both files**

```bash
git rm cron/api/account.ts cron/src/tests/account.test.ts
```

- [ ] **Step 3: Verify cron still typechecks and tests pass**

Run: `cd cron && npx tsc --noEmit && npm test`
Expected: typecheck clean; Jest green with the `account` suite gone.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(cron): remove dead /api/account endpoint (writes go through RPCs)"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck both packages**

Run: `cd cron && npx tsc --noEmit`
Expected: no errors.

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint both packages**

Run: `cd cron && npx eslint --ext .ts src`
Expected: no errors.

Run: `cd app && npx eslint --ext .ts,.tsx src`
Expected: no errors.

- [ ] **Step 3: Run the full test suites**

Run: `cd cron && npm test`
Expected: green.

Run: `cd app && npm test`
Expected: green.

- [ ] **Step 4: Format check from repo root**

Run: `npm run format:check`
Expected: pass (lint-staged formats on commit; this confirms nothing drifted).

- [ ] **Step 5: Finish the branch**

Use the **superpowers:finishing-a-development-branch** skill to verify tests, then present merge/PR options. Per repo policy, the PR targets `develop`. Before opening: run `/code-review`; because this is an auth/RLS/API change, also run `/security-review`.

---

## Self-Review Notes

- **Spec coverage:** Task 1 = RPCs + policy drop + DB verification; Tasks 2–3 = app RPC migration + call site; Task 4 = dead-code deletion; Task 5 = regression + rollout (one shot — schema and app land on the same branch/PR). `delete_my_account` and `register_device` are untouched, matching the spec's out-of-scope list.
- **Signature consistency:** `update_notify_time(p_id, p_notify_at)` and `link_device_to_user(p_id)` are used identically in the SQL (Task 1), the app code (Tasks 2–3), and the tests. `linkDeviceToUser` is single-arg everywhere after Task 3 (helper, call site, tests).
- **The `API_URL` / `EXPO_PUBLIC_API_URL` cleanup is intentionally excluded** (spec marks it optional/out-of-scope) to keep this change focused.
