# app/notifications — Slice 6 Design

Date: 2026-05-31
Owner: Janos Gorondi
Status: Approved design — pending implementation plan
Slice: Frontend slice 6 (the final parity slice)

Legacy references this slice replaces:

- `pulse-news-legacy/app/src/notifications/register.ts`
- `pulse-news-legacy/app/src/hooks/useDeviceRegistration.ts`
- `pulse-news-legacy/app/src/hooks/useAppServices.ts` (the two device side-effects only)
- `pulse-news-legacy/app/src/hooks/useAppNavigation.ts` (the `registerNotificationHandlers` wiring + `onDailyDigest`)

---

## 1. Scope

### Already complete in earlier slices — NOT this slice

The plan titles slice 6 "notification registration + deep link parsing + password recovery flow", but the deep-link/recovery third was pulled forward into the auth-flow slice and is done:

- `parseRecoveryPayload` + `useDeepLinkRecovery` — ported, tested, mounted in `useSupabaseAuth.ts:122`.
- `auth` slice `isPasswordRecovery` + `setIsPasswordRecovery`; `PASSWORD_RECOVERY` event handling; `ResetPasswordScreen`.
- `notifyTime` exists as a **preference** (`UserPreferences.notifyTime`), edited in Settings, shown in `DigestPage`.
- `device` slice exists as a stub: `notificationsEnabled: false`.

### This slice's actual work — the FCM notification half

1. Port the FCM registration module (split by external boundary).
2. Port `useDeviceRegistration` as a store-writer hook; replace the device stub with live values.
3. Add `navigateToDigest()` + a refresh nonce to the `nav` slice; wire `DigestPager` to refetch on nonce change.
4. Re-home the two dissolved `useAppServices` effects (`linkDeviceToUser`, `updateNotifyTime`) into `useDeviceRegistration`.
5. Wire FCM notification handlers to `navigateToDigest`, registered after boot reaches `ready`.
6. Introduce a store-resident boot gate so device registration co-gates the `prefs-loading → ready` transition (legacy ANDed `deviceReady`).

**Parity constraint:** same inputs → same outputs versus legacy on the Android target. Structural improvements (module split, store-resident gate, nonce-based refresh) are permitted because they do not change observable behavior. iOS-only branches are dropped because they are unreachable on the Android-only target — behavior-preserving on the platform we ship.

---

## 2. Module layout

```
app/src/notifications/
  fcm.ts        ← Firebase Messaging boundary
  devices.ts    ← Supabase `devices` table boundary
  register.ts   ← orchestrator + device identity
app/src/hooks/
  useDeviceRegistration.ts   ← store-writer hook (new)
  useNotificationHandlers.ts ← registers FCM tap handlers after `ready` (new)
```

Splitting by external boundary lets each side mock independently in tests: `register.ts` tests stub `devices.ts` + `fcm.ts`; `devices.ts` tests stub only the Supabase client; `fcm.ts` tests stub only `@react-native-firebase/messaging`.

### 2.1 `fcm.ts` — Firebase Messaging boundary

Owns every call into `@react-native-firebase/messaging` and the badge.

- `requestPushPermission(): Promise<boolean>` — `requestPermission(fcm, { sound:false, badge:true, alert:true, provisional:false })`; granted = `AUTHORIZED || PROVISIONAL`.
- `getFcmToken(): Promise<string | null>` — `getToken(fcm)`. **iOS pre-register branch removed** (Android-only). Returns null + warn on failure.
- `getNotificationPermission(): Promise<boolean>` — `hasPermission(fcm)` mapped to `AUTHORIZED || PROVISIONAL`. Used by the registration hook on mount and on every foreground.
- `listenForTokenRefresh(onToken: (t: string) => void): () => void` — wraps `onTokenRefresh`; returns unsubscribe. Re-upsert logic lives in the caller, not here (keeps the Supabase write out of the Firebase module).
- `registerNotificationHandlers(onDailyDigest: () => void): () => void` — `onNotificationOpenedApp` (background tap), `getInitialNotification` (killed tap, one-shot, `cancelled` guard), `onMessage` (foreground). Each filters `data.type === 'daily_digest'`, clears the badge, then calls `onDailyDigest`. Returns a combined unsubscribe.
- `clearNotificationBadge(): Promise<void>` — `setBadgeCountAsync(0)` from `expo-notifications`; warn on failure.

### 2.2 `devices.ts` — Supabase `devices` table boundary

Owns every write to the `devices` table. No-op + debug log when Supabase is unconfigured (parity).

- `upsertDevice({ deviceId, fcmToken, notifyAt? })` — upsert `(id, fcm_token, updated_at)` and `notify_at` when provided, `onConflict: 'id'`. Publishable key + open RLS (MVP parity; V2 edge-function note carried to `todo.md`).
- `linkDeviceToUser(deviceId, userId)` — `update({ user_id }).eq('id', deviceId)`.
- `updateNotifyTime(deviceId, notifyAt)` — reads cached FCM token from MMKV; skips when absent (device not yet registered); otherwise `upsertDevice` with `notifyAt`.

### 2.3 `register.ts` — orchestrator + identity

- `getOrCreateDeviceId(): Promise<string>` — stable UUID in MMKV (`pulse.device.id`), generated on first launch via `expo-crypto`.
- `registerForPushNotifications(): Promise<DeviceRegistration | null>` — idempotent: ensure device id → request permission (abort/null if denied) → fetch token (abort/null if none) → upsert only when the MMKV-cached token changed → cache token. Returns `{ deviceId, fcmToken }` or null. Idempotency makes React StrictMode double-invocation safe.
- Re-exports `DeviceRegistration` type.

---

## 3. Store changes

### 3.1 `device` slice (replace stub)

```ts
interface DeviceSlice {
  deviceId: string | null;
  fcmToken: string | null;
  notificationsEnabled: boolean; // now written for real
  deviceReady: boolean; // true on registration success OR timeout
  setDeviceRegistration: (r: { deviceId: string; fcmToken: string }) => void;
  setNotificationsEnabled: (v: boolean) => void;
  setDeviceReady: (v: boolean) => void;
}
```

`setDeviceReady(true)` calls `maybeAdvanceToReady()` (§3.3).

### 3.2 `nav` slice — `navigateToDigest` + refresh nonce

```ts
digestRefreshNonce: number;             // starts 0
navigateToDigest: () => void;           // set screen:'digest', dayIndex:0, bump nonce, persist
```

Replaces legacy's `onDailyDigestRef` + `activePageRef.forceRefresh()`. `navigateToDigest` is callable from outside React via `useAppStore.getState()`, so no ref dance.

`DigestPager` reads `digestRefreshNonce` via selector and calls React Query `refetch()` in an effect, **skipping the first run** with a ref so it does not duplicate the query's own initial fetch.

### 3.3 `app` slice — store-resident boot gate

The current `usePreferences` sets `appState = 'ready'` unilaterally after prefs hydrate. That transition moves into a guarded store action so device registration co-gates it:

```ts
prefsHydrated: boolean;
setPrefsHydrated: (v: boolean) => void;  // sets flag, then maybeAdvanceToReady()
maybeAdvanceToReady: () => void;         // if appState==='prefs-loading' && prefsHydrated && get().deviceReady → setAppState('ready')
```

`deviceReady` is owned by the `device` slice (§3.1); the app slice reads it via the combined store inside `maybeAdvanceToReady()`. Both writers — `setPrefsHydrated(true)` and `setDeviceReady(true)` — call `maybeAdvanceToReady()`, so whichever resolves last triggers the transition. `deviceReady` flips true on registration success **or** when `deviceRegistrationTimeoutMs` fires, so a slow Firebase call never blocks boot beyond the timeout.

**This is the only change to existing rebuild behavior** (it changes the rebuild's current boot path, while matching legacy's ANDed `deviceReady`). It gets a dedicated unit test.

---

## 4. Hooks

### 4.1 `useDeviceRegistration` (store-writer)

Mirrors legacy lifecycle, writes to the store instead of returning values:

- On mount (`[]` effect): start `registerForPushNotifications()` under a `deviceRegistrationTimeoutMs` guard. On success write `setDeviceRegistration({ deviceId, fcmToken })`, subscribe to token refresh (re-upsert + cache). Always `setNotificationsEnabled(await getNotificationPermission())`, always `setDeviceReady(true)` in `finally` (success, denial, or timeout). Clean up timer + token-refresh + AppState subscriptions on unmount.
- AppState `change` → on `active`, re-check `getNotificationPermission()` and update `notificationsEnabled` (live banner in Settings).
- Effect on `[session?.user.id, deviceId]`: `linkDeviceToUser` (guarded, warn on failure).
- Effect on `[deviceId, prefsHydrated, prefs.notifyTime]`: `updateNotifyTime(deviceId, prefs.notifyTime)`. Gated on `prefsHydrated` so the default notify time is not pushed before remote sync resolves (parity with legacy's `hydrated` gate).

### 4.2 `useNotificationHandlers`

A thin hook: when `appState === 'ready'`, call `registerNotificationHandlers(() => useAppStore.getState().navigateToDigest())`; return its unsubscribe on cleanup. Gating on `ready` guarantees `getInitialNotification` (killed-app tap) fires **after** `restoreNavState`, so the digest navigation is not clobbered by nav restore — the one ordering constraint inherited from legacy's `navReady` gate.

---

## 5. Testing

Unit (Jest + ts-jest, no renderer where possible):

- `fcm.ts`: permission granted/denied mapping; `getFcmToken` null-on-failure; handler `data.type` filtering (digest vs other); `getInitialNotification` one-shot guarded after unmount.
- `devices.ts`: upsert payload shape + `onConflict`; no-op when Supabase unconfigured; `updateNotifyTime` skip when no cached token.
- `register.ts`: idempotent skip-upsert when token unchanged; abort→null on permission denied / no token; device-id generate-then-persist.
- `device` slice: setters; `setDeviceReady` triggers advance.
- `nav` slice: `navigateToDigest` sets screen/day, bumps nonce, persists.
- `app` slice boot gate: advances only when `prefs-loading && prefsHydrated && deviceReady`; no advance if either flag false or state already `ready`/`unauthenticated`.

Target 60–70% on the logic that breaks silently. Skip presentation snapshots.

**Native reality:** `@react-native-firebase/messaging` cannot run in Expo Go; true end-to-end push needs a dev-client build with `app/android/app/google-services.json`. All logic above is unit-testable with module mocks; live push delivery is a manual device check, not CI.

---

## 6. PR workflow

1. Implement on `feat/app-notifications`, tests in the same PR.
2. `/code-review` — fix findings on the branch.
3. `/security-review` last — this slice touches notifications, Supabase writes, and the deep-link surface.
4. Open PR targeting `develop`, linking the four legacy files listed in the header.

---

## 7. Deferred to todo.md

- Replace the publishable-key direct `devices` upsert with a `register-device` Supabase Edge Function using the secret key (legacy V2 note, carried forward).
- iOS push support (the stripped `registerDeviceForRemoteMessages` / provisional paths) if/when an iOS target is added.
