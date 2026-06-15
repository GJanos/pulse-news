# Devices Table RLS Lockdown — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorming) → ready for implementation plan
**Branch:** `feat/devices-rls-lockdown`

## Goal

Remove the wide-open Row Level Security policies on the `devices` table and route
every client write through `SECURITY DEFINER` RPCs, so the shipped publishable
(anon) key can no longer read or tamper with the table directly.

## Background — current state

`devices` has RLS enabled but three fully-open policies:

```sql
CREATE POLICY "device self-select"   ON devices FOR SELECT USING (true);
CREATE POLICY "device self-register" ON devices FOR INSERT WITH CHECK (true);
CREATE POLICY "device self-update"   ON devices FOR UPDATE USING (true) WITH CHECK (true);
```

The app (publishable/anon key) touches `devices` through three paths:

| App function       | Mechanism                                 | Policy relied on            |
| ------------------ | ----------------------------------------- | --------------------------- |
| `upsertDevice`     | `register_device` RPC (SECURITY DEFINER)  | none — definer bypasses RLS |
| `linkDeviceToUser` | direct `UPDATE … SET user_id WHERE id=`   | `device self-update`        |
| `updateNotifyTime` | direct `UPDATE … SET notify_at WHERE id=` | `device self-update`        |

The `.select('id')` RETURNING tacked onto the two direct updates is what needs
the `device self-select` policy.

### Why `auth.uid()` RLS does not fit

Devices register and set `notify_at` **before login** — notifications work for
logged-out users. With the anon key, `auth.uid()` is `NULL` in those calls, so a
`user_id = auth.uid()` policy would block registration and notify-time writes for
every anonymous device (the common case). The data model is device-centric, not
user-centric.

### Threat closed

With `USING (true)` SELECT, anyone who extracts the publishable key from the
shipped APK can `SELECT *` and harvest every `fcm_token` ↔ `user_id` mapping, and
blind-`UPDATE`/`INSERT` arbitrary rows. This design removes that.

## Design

### Security model

Keep RLS **enabled** on `devices` and **drop all three policies**. With no
policies, RLS denies all direct `anon`/`authenticated` table access (no SELECT,
UPDATE, or INSERT). The service-role key (cron) bypasses RLS and is unaffected.

Every write flows through a `SECURITY DEFINER` RPC — the pattern `register_device`
already established. The per-install device UUID (random v4, stored in MMKV) is
the unguessable capability that authorizes touching a row. An attacker with the
publishable key can no longer enumerate the table or blind-update rows; they would
need to already know a specific device UUID.

### Database changes (`supabase/schema.sql`)

**1. `register_device`** — unchanged (already definer, already granted to anon).

**2. New `update_notify_time(p_id uuid, p_notify_at time) RETURNS boolean`:**

```sql
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
  RETURN FOUND;  -- false = no such device row (preserves the app's "not registered yet" warning)
END;
$$;

REVOKE EXECUTE ON FUNCTION update_notify_time(uuid, time) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION update_notify_time(uuid, time) TO anon, authenticated, service_role;
```

**3. New `link_device_to_user(p_id uuid) RETURNS boolean`:**

`user_id` is **not** a parameter — it is derived from the caller's JWT via
`auth.uid()`, so a device can only ever be linked to the authenticated caller's
own identity. (Confirmed safe: the app client has `persistSession: true` and the
app only calls this when a session exists, so supabase-js attaches the user JWT
and `auth.uid()` resolves.)

```sql
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
  RETURN FOUND;  -- false = device row not present yet (drives the app's retry)
END;
$$;

REVOKE EXECUTE ON FUNCTION link_device_to_user(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION link_device_to_user(uuid) TO authenticated, service_role;
```

`link_device_to_user` is granted to `authenticated` only (not `anon`) — it
requires an authenticated session by definition.

**4. Drop the open policies:**

```sql
DROP POLICY IF EXISTS "device self-select"   ON devices;
DROP POLICY IF EXISTS "device self-register" ON devices;
DROP POLICY IF EXISTS "device self-update"   ON devices;
```

RLS stays `ENABLE`d, so the table is now deny-all for direct anon/authenticated
access. The schema-file comments on the old policies are replaced with a note
explaining the RPC-only write surface.

### App changes (`app/src/notifications/devices.ts`)

**`updateNotifyTime`** — replace the direct update with the RPC; branch on the
returned boolean instead of `data.length`:

```ts
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
```

**`linkDeviceToUser`** — drop the `userId` parameter (now derived server-side from
the JWT); keep the 3× retry, switching the 0-row check to `data !== true`:

```ts
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
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  log.warn(
    `linkDeviceToUser: no device row for ${deviceId.slice(0, 8)}… after ${MAX_ATTEMPTS} attempts`,
  );
}
```

**`useDeviceRegistration.ts`** — update the call site from
`linkDeviceToUser(deviceId, userId)` to `linkDeviceToUser(deviceId)`. The `userId`
gate (only call when a session exists) stays.

After these edits, `app/src/notifications/devices.ts` no longer references
`.from('devices')` at all.

### Dead-code removal

`cron/api/account.ts` is never called by the app:

- Account deletion uses the `delete_my_account` RPC (`useSupabaseAuth.ts:92`).
- Device registration uses the `register_device` RPC (`devices.ts`).
- `API_URL` (`app/src/config.ts:21`) is declared but never fetched.

Delete:

- `cron/api/account.ts`
- `cron/src/tests/account.test.ts`

Optional follow-up cleanup (not required for this change): remove the now-dead
`API_URL` constant and its `EXPO_PUBLIC_API_URL` reference from the app config and
`.env.example`. Listed but out of scope to keep this change focused.

## Testing

### App unit tests (`app/src/tests/notifications/devices.test.ts`)

Rewrite the cases that currently mock `.from('devices').update().eq().select()`:

- `updateNotifyTime` → mock `supabase.rpc('update_notify_time', …)`:
  - returns `{ data: true }` → debug success, no warn.
  - returns `{ data: false }` → "not registered yet" warn.
  - returns `{ error }` → failure warn.
  - skips entirely when no cached FCM token (unchanged behavior).
- `linkDeviceToUser` → mock `supabase.rpc('link_device_to_user', …)`:
  - `{ data: true }` first try → linked, single call.
  - `{ data: false }` then `{ data: true }` → retried, eventually linked.
  - `{ data: false }` ×3 → gives up with warn.
  - `{ error }` → immediate return, no retry.

### Database verification (run once against the live project)

Run via the Supabase SQL editor (or `mcp__supabase.execute_sql`) to prove the
lockdown. `SET ROLE` simulates the anon/authenticated PostgREST roles:

```sql
-- anon: direct SELECT must be denied (no rows / permission), proving harvest is closed.
SET ROLE anon;
SELECT count(*) FROM devices;          -- expect 0 rows visible (RLS denies)
RESET ROLE;

-- anon: register + notify-time RPCs must be callable.
SET ROLE anon;
SELECT register_device('00000000-0000-4000-8000-0000000000c3', 'rls-test-token', NULL);
SELECT update_notify_time('00000000-0000-4000-8000-0000000000c3', '09:00');
RESET ROLE;

-- anon: link RPC must be rejected (no auth.uid()).
SET ROLE anon;
SELECT link_device_to_user('00000000-0000-4000-8000-0000000000c3');  -- expect EXCEPTION
RESET ROLE;

-- cleanup
DELETE FROM devices WHERE id = '00000000-0000-4000-8000-0000000000c3';
```

(Document the expected outcome of each statement in the plan; this is a manual
verification, not an automated test, because the cron environment holds only the
service-role key, not the publishable key.)

### Regression

- `cron npm test` — green after deleting `account.test.ts` (the suite no longer
  references the route).
- `app npm test` — green with the rewritten `devices.test.ts`.
- Typecheck + lint both packages.

## Rollout

Single shot — the user is the sole user, so no phased client migration is needed.
Apply the schema (add RPCs + grants, drop policies) and ship the app update
together. Order within the migration: create/replace the RPCs and grants first,
then drop the policies, so the table is never left writable-by-nobody mid-migration.

## Out of scope

- Removing the `API_URL` / `EXPO_PUBLIC_API_URL` config (optional cleanup noted above).
- Any change to `register_device`, `delete_my_account`, or the notify-window RPCs.
- `user_preferences` / `digests` / `notify_state` RLS (already correct).
