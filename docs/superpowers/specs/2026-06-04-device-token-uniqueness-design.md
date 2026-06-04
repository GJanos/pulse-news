# Device–Token Uniqueness — Design

**Date:** 2026-06-04
**Status:** Approved (pending spec review)
**Related:** commit `132b244` (dispatch-time FCM token dedup — the shipped symptom fix)

## Problem

One physical device can own several `devices` rows. The per-install UUID (`devices.id`, the
primary key) is regenerated on every reinstall (MMKV is wiped), while Google Play Services keeps
handing back the **same FCM token** across reinstalls. Because `fcm_token` has no unique
constraint and registration upserts `onConflict: 'id'`, each reinstall inserts a **fresh row that
shares the surviving token**. The dispatcher then multicast to every row, so one device received
one push per duplicate row (observed: 3 notifications from 3 rows sharing one token).

`132b244` already fixed the **user-facing symptom** by deduplicating the token set inside
`dispatchFcm` before batching. That stays. This spec fixes the **source**: stop duplicate rows
from being created at all, so the `devices` table can't accumulate orphan rows. Notification
correctness is already handled; this is data-hygiene depth.

### Why neither single conflict key works

A device has two identifiers, each unstable across a _different_ event:

- `id` — stable across token rotations, **regenerated on reinstall**.
- `fcm_token` — **rotates frequently** via `onTokenRefresh`, survives reinstall.

| Conflict key                 | Token rotation (frequent)                                                                           | Reinstall (rare)                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `onConflict: 'id'` (current) | same id, new token → update in place ✓ one row                                                      | new id, same token → INSERT → **dup row** ✗ |
| `onConflict: 'fcm_token'`    | same id, new token → no token conflict; **PK violation on `id` not caught → registration errors** ✗ | new id, same token → update ✓               |

Swapping the conflict key trades a rare-event bug for a frequent-event hard failure. The correct
fix keeps `id` as the conflict target (right for rotation) **and** adds a uniqueness guarantee plus
an explicit eviction of any _other_ row that holds the incoming token (covers reinstall).

## Design

### 1. Schema (`supabase/schema.sql`)

Add a unique constraint and a registration RPC.

```sql
ALTER TABLE devices ADD CONSTRAINT devices_fcm_token_key UNIQUE (fcm_token);
```

`UNIQUE(fcm_token)` is the structural backstop: two rows sharing one token become impossible. It
is semantically correct — an FCM token identifies exactly one app install / delivery target.

```sql
-- Register (or refresh) a device. Runs as definer so it can evict the prior owner of this
-- token — the app's publishable key has no DELETE policy on `devices`.
CREATE OR REPLACE FUNCTION register_device(
  p_id      uuid,
  p_token   text,
  p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reinstall ghost / FCM token reassignment: a different row currently owns this token. Evict
  -- it so the UNIQUE(fcm_token) upsert below can take the token over.
  DELETE FROM devices WHERE fcm_token = p_token AND id <> p_id;

  -- Upsert by the stable per-install id. Only overwrite user_id when provided, so a pre-auth
  -- re-register (p_user_id = NULL) never clobbers an existing link. notify_at is intentionally
  -- untouched — it is owned by updateNotifyTime (see §3), and registration must preserve it.
  INSERT INTO devices (id, fcm_token, user_id, updated_at)
  VALUES (p_id, p_token, p_user_id, now())
  ON CONFLICT (id) DO UPDATE SET
    fcm_token  = EXCLUDED.fcm_token,
    user_id    = COALESCE(EXCLUDED.user_id, devices.user_id),
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION register_device(uuid, text, uuid) TO anon, authenticated, service_role;
```

Behaviour:

- **Token rotation** (same id, new token): `DELETE … id <> p_id` matches nothing; upsert updates
  the row in place. One row.
- **Reinstall** (new id, surviving token): `DELETE` removes the old-id ghost; upsert inserts the
  new id. One row.
- **No `delete_device()` RPC** — YAGNI. Every existing delete already runs with the service-role
  key (cron stale-token eviction in `dispatchFcm`; account deletion via `admin.deleteUser` →
  `user_id` cascade) and bypasses RLS. The app has no feature that deletes a device row. Add a
  symmetric `delete_device(p_id)` definer RPC _only_ when a real flow needs it (e.g. "sign out and
  forget this device"); building it now means guessing semantics with no caller.

### 2. App registration (`app/src/notifications/devices.ts`)

`upsertDevice` calls the RPC instead of `.upsert(…, { onConflict: 'id' })`:

```ts
const { error } = await supabase.rpc('register_device', {
  p_id: deviceId,
  p_token: fcmToken,
  // p_user_id omitted — linkDeviceToUser stamps it after login.
});
```

The `notifyAt` parameter is removed from `upsertDevice` — registration no longer carries it.

### 3. notify_at path (`app/src/notifications/devices.ts`)

`updateNotifyTime` stops piggy-backing on `upsertDevice` and becomes a direct, explicit update —
the publishable key's existing `UPDATE … USING(true)` policy already permits it, and no token/id
changes, so no eviction is needed:

```ts
const { error } = await supabase
  .from('devices')
  .update({ notify_at: notifyAt, updated_at: new Date().toISOString() })
  .eq('id', deviceId);
```

This also resolves the undefined-vs-null ambiguity: `notify_at = null` ("notify at default cron
time") is set explicitly here, while registration never writes it.

`linkDeviceToUser` is **unchanged** — it remains a direct `UPDATE … .eq('id', …)` of `user_id`.

### 4. Cron registration (`cron/api/account.ts`)

`handleRegister` routes through the same RPC, passing `p_user_id`:

```ts
const { error } = await db.rpc('register_device', {
  p_id: body.deviceId,
  p_token: body.fcmToken,
  p_user_id: userId,
});
```

Its previous `notify_at` write is dropped (registration does not own `notify_at`). Note: the
current app does not call `POST /api/account` for registration (it writes Supabase directly), so
this endpoint appears unused by today's client; it is updated for consistency and to keep the
single canonical write mechanism.

### 5. Unchanged (kept as-is)

- **`dispatchFcm` token dedup** (`132b244`) — kept as a cheap defense-in-depth backstop. With the
  source fix and `UNIQUE(fcm_token)` it becomes a no-op in practice, but it protects against the
  rollout window (old app versions still upserting on `id`) and any future query that fans out.
- **`dispatchFcm` stale-token eviction** — `delete().in('fcm_token', …)`, service-role, unaffected.
- **Account deletion cascade** — `user_id → SET NULL`, unchanged.

### 6. Database reset

No data migration. The maintainer is the sole tester in a testing-phase database; the table is
**wiped** before `UNIQUE(fcm_token)` is applied, eliminating the dedupe-existing-rows-with-tie-break
step a production migration would require.

## Testing

- **cron** (`cron/src/tests/`): `handleRegister` calls `rpc('register_device', …)` with the right
  args; keep the existing `dispatchFcm` dedup test.
- **app** (`app/src/tests/notifications/devices.test.ts`): `upsertDevice` calls `rpc(...)` with
  `p_id`/`p_token`; `updateNotifyTime` issues a direct `update().eq('id', …)`; `linkDeviceToUser`
  unchanged.
- **RPC behaviour** is a Postgres-side guarantee; verify manually against the test DB (rotation
  keeps one row; reinstall-with-surviving-token collapses to one row).

## Out of scope

- `delete_device()` RPC (deferred until a caller exists).
- Locking down the open `devices` RLS policies (tracked separately as the V2 Edge Function work).
- Any change to how `id` is generated or stored on the app side.
