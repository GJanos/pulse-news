# app/notifications (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the FCM push-notification half of the app — device registration, Supabase `devices` writes, notification-tap navigation, and a store-resident boot gate — completing parity with legacy.

**Architecture:** The legacy `notifications/register.ts` is split by external boundary into `fcm.ts` (Firebase Messaging), `devices.ts` (Supabase), and `register.ts` (orchestrator + device identity), with shared constants in `keys.ts`. Two store-writer hooks drive it: `useDeviceRegistration` (lifecycle + `linkDeviceToUser` + `updateNotifyTime`) and `useNotificationHandlers` (tap → `navigateToDigest`). Boot readiness moves into the `app` slice so device registration co-gates `prefs-loading → ready`.

**Tech Stack:** React Native (Expo, Android-only), Zustand, React Query, `@react-native-firebase/messaging`, `expo-notifications`, `expo-crypto`, Jest + ts-jest.

**Design spec:** `docs/superpowers/specs/2026-05-31-app-notifications-design.md`

**Legacy references:** `pulse-news-legacy/app/src/notifications/register.ts`, `…/hooks/useDeviceRegistration.ts`, `…/hooks/useAppServices.ts`, `…/hooks/useAppNavigation.ts`.

---

## File structure

**Create:**

- `app/src/notifications/keys.ts` — shared MMKV keys + notification type constant
- `app/src/notifications/fcm.ts` — Firebase Messaging boundary + badge
- `app/src/notifications/devices.ts` — Supabase `devices` table boundary
- `app/src/notifications/register.ts` — orchestrator + device identity + token cache
- `app/src/hooks/useDeviceRegistration.ts` — store-writer: registration lifecycle, link, notify-time sync
- `app/src/hooks/useNotificationHandlers.ts` — registers FCM tap handlers when `ready`
- Tests mirroring each under `app/src/tests/…`

**Modify:**

- `app/src/store/slices/device.ts` — identity fields, replace stub
- `app/src/store/slices/app.ts` — boot flags + `maybeAdvanceToReady`
- `app/src/store/slices/nav.ts` — `navigateToDigest` + `digestRefreshNonce`
- `app/src/hooks/usePreferences.ts` — signal `prefsHydrated` instead of `ready`
- `app/src/hooks/useAuthInit.ts` — call `maybeAdvanceToReady` after entering `prefs-loading`
- `app/src/components/DigestPager.tsx` — refetch active page on nonce change
- `app/App.tsx` — mount the two new hooks
- `app/package.json` — add `@react-native-firebase/messaging`
- `todo.md` — record deferred items

**Notes for the implementer (read once):**

- Run all commands from `app/`. Test runner: `npx jest --config jest.config.cjs <path>`. Typecheck: `npx tsc --noEmit`. Lint: `npx eslint --ext .ts,.tsx src`.
- `tsc` resolves the **real** `@supabase/supabase-js` / firebase types; Jest's `moduleNameMapper` swaps **runtime** modules for mocks in `app/__mocks__`. So `supabase.from(...)` type-checks against real types while tests run against the mock — mirror the existing `storage/preferences.ts` test approach.
- The store is a singleton (`useAppStore`); slice unit tests build a standalone slice via `create()` (see existing `app.test.ts`). Hook tests use `renderHook`/`act`/`waitFor` from `@testing-library/react-native` and drive the real singleton with `useAppStore.setState(...)`.
- `Platform.OS` is `'android'` in the RN mock — iOS branches are dropped, so no Platform import is needed anywhere in this slice.

---

## Task 1: Add the Firebase Messaging dependency

**Files:**

- Modify: `app/package.json`

- [ ] **Step 1: Install the native module**

Run (from `app/`):

```bash
npx expo install @react-native-firebase/messaging
```

Expected: `@react-native-firebase/messaging` added to `dependencies` at a version compatible with `@react-native-firebase/app@^24` and Expo SDK 56.

- [ ] **Step 2: Verify it resolves for typechecking**

Run: `npx tsc --noEmit`
Expected: PASS (no `Cannot find module '@react-native-firebase/messaging'`). Existing code is unchanged, so the only effect is the new types being available.

- [ ] **Step 3: Commit**

```bash
git add app/package.json app/package-lock.json
git commit -m "build(app): add @react-native-firebase/messaging for slice 6"
```

---

## Task 2: Shared keys + Supabase `devices` boundary (`devices.ts`)

**Files:**

- Create: `app/src/notifications/keys.ts`
- Create: `app/src/notifications/devices.ts`
- Test: `app/src/tests/notifications/devices.test.ts`

- [ ] **Step 1: Create the shared constants (no test — trivial constants)**

`app/src/notifications/keys.ts`:

```ts
export const DEVICE_ID_KEY = 'pulse.device.id';
export const TOKEN_KEY = 'pulse.device.fcmToken';
export const DAILY_DIGEST_TYPE = 'daily_digest';
```

- [ ] **Step 2: Write the failing test**

`app/src/tests/notifications/devices.test.ts`:

```ts
import { storage } from '../../storage/mmkv';
import { getSupabase } from '../../supabase/client';
import { TOKEN_KEY } from '../../notifications/keys';
import { upsertDevice, linkDeviceToUser, updateNotifyTime } from '../../notifications/devices';

jest.mock('../../supabase/client', () => ({ getSupabase: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;

interface FakeClient {
  upsert: jest.Mock;
  update: jest.Mock;
  eq: jest.Mock;
}

function makeClient(): FakeClient & { from: jest.Mock } {
  const api: FakeClient = {
    upsert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn(),
    eq: jest.fn().mockResolvedValue({ error: null }),
  };
  api.update.mockReturnValue({ eq: api.eq });
  const from = jest.fn().mockReturnValue(api);
  return Object.assign(api, { from });
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
});

describe('upsertDevice', () => {
  it('writes id + fcm_token + updated_at with onConflict id', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    expect(client.from).toHaveBeenCalledWith('devices');
    const [payload, opts] = client.upsert.mock.calls[0];
    expect(payload).toMatchObject({ id: 'dev-1', fcm_token: 'tok-1' });
    expect(typeof payload.updated_at).toBe('string');
    expect(payload.notify_at).toBeUndefined();
    expect(opts).toEqual({ onConflict: 'id' });
  });

  it('includes notify_at only when provided', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1', notifyAt: '08:15' });
    expect(client.upsert.mock.calls[0][0].notify_at).toBe('08:15');
  });

  it('no-ops when Supabase is unconfigured', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(upsertDevice({ deviceId: 'dev-1', fcmToken: 'tok-1' })).resolves.toBeUndefined();
  });
});

describe('linkDeviceToUser', () => {
  it('updates user_id filtered by device id', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await linkDeviceToUser('dev-1', 'user-9');
    expect(client.update).toHaveBeenCalledWith({ user_id: 'user-9' });
    expect(client.eq).toHaveBeenCalledWith('id', 'dev-1');
  });
});

describe('updateNotifyTime', () => {
  it('skips when no FCM token is cached', async () => {
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('upserts notify_at using the cached token when present', async () => {
    storage.set(TOKEN_KEY, 'tok-cached');
    const client = makeClient();
    mockGetSupabase.mockReturnValue(client as never);
    await updateNotifyTime('dev-1', '09:00');
    expect(client.upsert.mock.calls[0][0]).toMatchObject({
      id: 'dev-1',
      fcm_token: 'tok-cached',
      notify_at: '09:00',
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/notifications/devices.test.ts`
Expected: FAIL with `Cannot find module '../../notifications/devices'`.

- [ ] **Step 4: Implement `devices.ts`**

`app/src/notifications/devices.ts`:

```ts
import { getSupabase } from '../supabase/client';
import { storage } from '../storage/mmkv';
import { TOKEN_KEY } from './keys';
import { getLogger } from '../logger';

const log = getLogger('devices');

interface UpsertParams {
  deviceId: string;
  fcmToken: string;
  notifyAt?: string | null; // "HH:MM" or null
}

/**
 * Upsert (id, fcm_token, updated_at) into the Supabase `devices` table,
 * adding notify_at only when provided. No-op when Supabase is unconfigured.
 * Uses the publishable key — allowed by the INSERT/UPDATE RLS policies.
 */
export async function upsertDevice({ deviceId, fcmToken, notifyAt }: UpsertParams): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) {
    log.debug('upsertDevice skipped — Supabase not configured');
    return;
  }
  log.info(
    `upserting device ${deviceId.slice(0, 8)}…${notifyAt !== undefined ? ` (notify_at=${notifyAt ?? 'null'})` : ''}`,
  );
  const payload: Record<string, unknown> = {
    id: deviceId,
    fcm_token: fcmToken,
    updated_at: new Date().toISOString(),
  };
  if (notifyAt !== undefined) payload['notify_at'] = notifyAt;

  const { error } = await supabase.from('devices').upsert(payload, { onConflict: 'id' });
  if (error) log.warn(`upsertDevice failed: ${error.message}`);
  else log.debug(`device ${deviceId.slice(0, 8)}… upserted successfully`);
}

/** Associate this device with the authenticated user. No-op when unconfigured. */
export async function linkDeviceToUser(deviceId: string, userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from('devices').update({ user_id: userId }).eq('id', deviceId);
  if (error) log.warn(`linkDeviceToUser failed: ${error.message}`);
  else log.info(`device ${deviceId.slice(0, 8)}… linked to user ${userId.slice(0, 8)}…`);
}

/**
 * Update only this device's notify_at column. Reads the cached FCM token;
 * skips when the device has not registered yet (no token to anchor the row).
 */
export async function updateNotifyTime(deviceId: string, notifyAt: string | null): Promise<void> {
  const cachedToken = storage.getString(TOKEN_KEY) ?? null;
  if (!cachedToken) {
    log.debug('updateNotifyTime: no cached token — device not yet registered, skipping');
    return;
  }
  log.info(`updating notify_at → ${notifyAt ?? 'null'} for device ${deviceId.slice(0, 8)}…`);
  await upsertDevice({ deviceId, fcmToken: cachedToken, notifyAt });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/notifications/devices.test.ts`
Expected: PASS (8 assertions across 6 tests).

- [ ] **Step 6: Commit**

```bash
git add app/src/notifications/keys.ts app/src/notifications/devices.ts app/src/tests/notifications/devices.test.ts
git commit -m "feat(app/notifications): port Supabase devices boundary"
```

---

## Task 3: Firebase Messaging boundary (`fcm.ts`)

**Files:**

- Create: `app/src/notifications/fcm.ts`
- Test: `app/src/tests/notifications/fcm.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/tests/notifications/fcm.test.ts`:

```ts
const messagingMocks = {
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  requestPermission: jest.fn(),
  hasPermission: jest.fn(),
  onTokenRefresh: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  onMessage: jest.fn(() => jest.fn()),
  getInitialNotification: jest.fn().mockResolvedValue(null),
  AuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },
};
jest.mock('@react-native-firebase/messaging', () => messagingMocks);
jest.mock('expo-notifications', () => ({
  setBadgeCountAsync: jest.fn().mockResolvedValue(undefined),
}));

import { setBadgeCountAsync } from 'expo-notifications';
import {
  requestPushPermission,
  getFcmToken,
  getNotificationPermission,
  registerNotificationHandlers,
} from '../../notifications/fcm';

beforeEach(() => jest.clearAllMocks());

describe('permission + token', () => {
  it('requestPushPermission true for AUTHORIZED', async () => {
    messagingMocks.requestPermission.mockResolvedValue(2);
    expect(await requestPushPermission()).toBe(true);
  });

  it('requestPushPermission true for PROVISIONAL', async () => {
    messagingMocks.requestPermission.mockResolvedValue(3);
    expect(await requestPushPermission()).toBe(true);
  });

  it('requestPushPermission false for DENIED', async () => {
    messagingMocks.requestPermission.mockResolvedValue(1);
    expect(await requestPushPermission()).toBe(false);
  });

  it('getFcmToken returns the token string', async () => {
    messagingMocks.getToken.mockResolvedValue('tok-abc');
    expect(await getFcmToken()).toBe('tok-abc');
  });

  it('getFcmToken returns null on empty token', async () => {
    messagingMocks.getToken.mockResolvedValue('');
    expect(await getFcmToken()).toBeNull();
  });

  it('getFcmToken returns null when getToken throws', async () => {
    messagingMocks.getToken.mockRejectedValue(new Error('boom'));
    expect(await getFcmToken()).toBeNull();
  });

  it('getNotificationPermission maps AUTHORIZED to true', async () => {
    messagingMocks.hasPermission.mockResolvedValue(2);
    expect(await getNotificationPermission()).toBe(true);
  });

  it('getNotificationPermission maps DENIED to false', async () => {
    messagingMocks.hasPermission.mockResolvedValue(1);
    expect(await getNotificationPermission()).toBe(false);
  });
});

describe('registerNotificationHandlers', () => {
  it('fires onDailyDigest for a daily_digest background tap and clears the badge', () => {
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    const cb = messagingMocks.onNotificationOpenedApp.mock.calls[0][1] as (m: unknown) => void;
    cb({ data: { type: 'daily_digest' } });
    expect(onDigest).toHaveBeenCalledTimes(1);
    expect(setBadgeCountAsync).toHaveBeenCalledWith(0);
  });

  it('ignores non-digest messages', () => {
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    const cb = messagingMocks.onMessage.mock.calls[0][1] as (m: unknown) => void;
    cb({ data: { type: 'something_else' } });
    expect(onDigest).not.toHaveBeenCalled();
  });

  it('fires onDailyDigest for a killed-app initial notification', async () => {
    messagingMocks.getInitialNotification.mockResolvedValue({ data: { type: 'daily_digest' } });
    const onDigest = jest.fn();
    registerNotificationHandlers(onDigest);
    await Promise.resolve();
    await Promise.resolve();
    expect(onDigest).toHaveBeenCalledTimes(1);
  });

  it('cleanup unsubscribes both live listeners', () => {
    const unsubBg = jest.fn();
    const unsubFg = jest.fn();
    messagingMocks.onNotificationOpenedApp.mockReturnValue(unsubBg);
    messagingMocks.onMessage.mockReturnValue(unsubFg);
    const cleanup = registerNotificationHandlers(jest.fn());
    cleanup();
    expect(unsubBg).toHaveBeenCalled();
    expect(unsubFg).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/notifications/fcm.test.ts`
Expected: FAIL with `Cannot find module '../../notifications/fcm'`.

- [ ] **Step 3: Implement `fcm.ts`**

`app/src/notifications/fcm.ts`:

```ts
import {
  getMessaging,
  getToken,
  requestPermission,
  hasPermission,
  onTokenRefresh,
  onNotificationOpenedApp,
  onMessage,
  getInitialNotification,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import { setBadgeCountAsync } from 'expo-notifications';

import { DAILY_DIGEST_TYPE } from './keys';
import { getLogger } from '../logger';

const fcm = getMessaging();
const log = getLogger('fcm');

function isGranted(status: number): boolean {
  return status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
}

async function clearNotificationBadge(): Promise<void> {
  try {
    await setBadgeCountAsync(0);
    log.debug('notification badge cleared');
  } catch (e: unknown) {
    log.warn(`clearNotificationBadge failed: ${String(e)}`);
  }
}

/** Ask for push permission. True for granted or provisional (quiet) grants. */
export async function requestPushPermission(): Promise<boolean> {
  log.info('requesting push notification permission');
  const status = await requestPermission(fcm, {
    sound: false, // once-daily quiet push — no sound
    badge: true,
    alert: true,
    provisional: false,
  });
  const granted = isGranted(status);
  if (granted) log.info(`push permission granted (status: ${status})`);
  else log.warn(`push permission denied (status: ${status})`);
  return granted;
}

/** Fetch the current FCM token. Returns null when unavailable. */
export async function getFcmToken(): Promise<string | null> {
  try {
    const token = await getToken(fcm);
    if (token) log.info(`FCM token obtained: ${token.slice(0, 20)}…`);
    else log.warn('FCM token unavailable — getToken returned empty string');
    return token || null;
  } catch (e) {
    log.warn(`getFcmToken failed: ${String(e)}`);
    return null;
  }
}

/** Live OS permission state for this app. */
export async function getNotificationPermission(): Promise<boolean> {
  const status = await hasPermission(fcm);
  return isGranted(status);
}

/** Subscribe to FCM token rotation. Returns the unsubscribe function. */
export function onFcmTokenRefresh(onToken: (token: string) => void): () => void {
  return onTokenRefresh(fcm, onToken);
}

/**
 * Wire the three notification-interaction handlers (background tap, killed-app
 * initial notification, foreground message). Each fires `onDailyDigest` only
 * for a `daily_digest` payload, after clearing the badge. Returns an unsubscribe.
 */
export function registerNotificationHandlers(onDailyDigest: () => void): () => void {
  let cancelled = false;
  log.info('registering FCM notification handlers');

  const handle = (source: string, data: Record<string, unknown> | undefined): void => {
    log.info(`${source}: type=${String(data?.['type'])}`);
    if (data?.['type'] === DAILY_DIGEST_TYPE) {
      void clearNotificationBadge();
      onDailyDigest();
    }
  };

  const unsubBackground = onNotificationOpenedApp(fcm, (msg) =>
    handle('onNotificationOpenedApp', msg.data),
  );

  // One-shot read — cancelled guard prevents acting after unmount.
  getInitialNotification(fcm)
    .then((msg) => {
      if (!cancelled && msg) handle('getInitialNotification', msg.data);
    })
    .catch((e: unknown) => log.warn(`getInitialNotification failed: ${String(e)}`));

  const unsubForeground = onMessage(fcm, (msg) => handle('onMessage (foreground)', msg.data));

  return () => {
    cancelled = true;
    unsubBackground();
    unsubForeground();
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/notifications/fcm.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/notifications/fcm.ts app/src/tests/notifications/fcm.test.ts
git commit -m "feat(app/notifications): port Firebase Messaging boundary (Android-only)"
```

---

## Task 4: Orchestrator + device identity (`register.ts`)

**Files:**

- Create: `app/src/notifications/register.ts`
- Test: `app/src/tests/notifications/register.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/tests/notifications/register.test.ts`:

```ts
import { storage } from '../../storage/mmkv';
import { DEVICE_ID_KEY, TOKEN_KEY } from '../../notifications/keys';
import * as fcm from '../../notifications/fcm';
import * as devices from '../../notifications/devices';
import { registerForPushNotifications, listenForTokenRefresh } from '../../notifications/register';

jest.mock('../../notifications/fcm');
jest.mock('../../notifications/devices');
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'uuid-generated') }));

const mockFcm = fcm as jest.Mocked<typeof fcm>;
const mockDevices = devices as jest.Mocked<typeof devices>;

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
  mockFcm.requestPushPermission.mockResolvedValue(true);
  mockFcm.getFcmToken.mockResolvedValue('tok-new');
  mockDevices.upsertDevice.mockResolvedValue(undefined);
});

describe('registerForPushNotifications', () => {
  it('generates and persists a device id on first run', async () => {
    const reg = await registerForPushNotifications();
    expect(reg).toEqual({ deviceId: 'uuid-generated', fcmToken: 'tok-new' });
    expect(storage.getString(DEVICE_ID_KEY)).toBe('uuid-generated');
  });

  it('reuses the persisted device id on later runs', async () => {
    storage.set(DEVICE_ID_KEY, 'uuid-existing');
    const reg = await registerForPushNotifications();
    expect(reg?.deviceId).toBe('uuid-existing');
  });

  it('upserts and caches the token when it changed', async () => {
    await registerForPushNotifications();
    expect(mockDevices.upsertDevice).toHaveBeenCalledWith({
      deviceId: 'uuid-generated',
      fcmToken: 'tok-new',
    });
    expect(storage.getString(TOKEN_KEY)).toBe('tok-new');
  });

  it('skips the upsert when the cached token is unchanged', async () => {
    storage.set(TOKEN_KEY, 'tok-new');
    await registerForPushNotifications();
    expect(mockDevices.upsertDevice).not.toHaveBeenCalled();
  });

  it('returns null when permission is denied', async () => {
    mockFcm.requestPushPermission.mockResolvedValue(false);
    expect(await registerForPushNotifications()).toBeNull();
    expect(mockFcm.getFcmToken).not.toHaveBeenCalled();
  });

  it('returns null when no token is available', async () => {
    mockFcm.getFcmToken.mockResolvedValue(null);
    expect(await registerForPushNotifications()).toBeNull();
    expect(mockDevices.upsertDevice).not.toHaveBeenCalled();
  });
});

describe('listenForTokenRefresh', () => {
  it('re-upserts and re-caches on rotation', async () => {
    let captured: ((t: string) => Promise<void>) | undefined;
    mockFcm.onFcmTokenRefresh.mockImplementation((cb) => {
      captured = cb as (t: string) => Promise<void>;
      return jest.fn();
    });
    listenForTokenRefresh('dev-1');
    await captured?.('tok-rotated');
    expect(mockDevices.upsertDevice).toHaveBeenCalledWith({
      deviceId: 'dev-1',
      fcmToken: 'tok-rotated',
    });
    expect(storage.getString(TOKEN_KEY)).toBe('tok-rotated');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/notifications/register.test.ts`
Expected: FAIL with `Cannot find module '../../notifications/register'`.

- [ ] **Step 3: Implement `register.ts`**

`app/src/notifications/register.ts`:

```ts
import * as Crypto from 'expo-crypto';

import { storage } from '../storage/mmkv';
import { DEVICE_ID_KEY, TOKEN_KEY } from './keys';
import { requestPushPermission, getFcmToken, onFcmTokenRefresh } from './fcm';
import { upsertDevice } from './devices';
import { getLogger } from '../logger';

const log = getLogger('register');

export interface DeviceRegistration {
  deviceId: string;
  fcmToken: string;
}

/** Returns this install's stable UUID; generates and persists on first call. */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = storage.getString(DEVICE_ID_KEY) ?? null;
  if (existing) {
    log.debug(`device ID: ${existing.slice(0, 8)}… (existing)`);
    return existing;
  }
  const uuid = Crypto.randomUUID();
  storage.set(DEVICE_ID_KEY, uuid);
  log.info(`new device ID generated: ${uuid.slice(0, 8)}…`);
  return uuid;
}

/**
 * Full registration flow. Idempotent — safe on every launch (so React
 * StrictMode double-invocation is harmless). Returns null when permission
 * is denied or no token is obtainable.
 */
export async function registerForPushNotifications(): Promise<DeviceRegistration | null> {
  log.info('registerForPushNotifications: starting');
  const deviceId = await getOrCreateDeviceId();

  const granted = await requestPushPermission();
  if (!granted) {
    log.warn('registration aborted — push permission denied');
    return null;
  }

  const fcmToken = await getFcmToken();
  if (!fcmToken) {
    log.warn('registration aborted — no FCM token available');
    return null;
  }

  const cachedToken = storage.getString(TOKEN_KEY) ?? null;
  if (cachedToken !== fcmToken) {
    log.info('FCM token changed — upserting device record');
    await upsertDevice({ deviceId, fcmToken });
    storage.set(TOKEN_KEY, fcmToken);
  } else {
    log.debug('FCM token unchanged — skipping upsert');
  }

  log.info(`registration complete: device=${deviceId.slice(0, 8)}…`);
  return { deviceId, fcmToken };
}

/** Re-upsert + re-cache when Firebase rotates the token. Returns unsubscribe. */
export function listenForTokenRefresh(deviceId: string): () => void {
  log.debug(`subscribed to FCM token-refresh events for device ${deviceId.slice(0, 8)}…`);
  return onFcmTokenRefresh(async (newToken: string) => {
    log.info(`FCM token refreshed for device ${deviceId.slice(0, 8)}… — re-upserting`);
    await upsertDevice({ deviceId, fcmToken: newToken });
    storage.set(TOKEN_KEY, newToken);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/notifications/register.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/notifications/register.ts app/src/tests/notifications/register.test.ts
git commit -m "feat(app/notifications): port registration orchestrator + device identity"
```

---

## Task 5: Expand the `device` slice (identity, drop the stub)

**Files:**

- Modify: `app/src/store/slices/device.ts`
- Test: `app/src/tests/store/slices/device.test.ts`

- [ ] **Step 1: Update the test to the new shape**

Replace the body of `app/src/tests/store/slices/device.test.ts` below the `makeSlice` helper (keep the existing `makeSlice` function and import lines unchanged):

```ts
describe('DeviceSlice', () => {
  it('initialises with no identity and notifications disabled', () => {
    const slice = makeSlice();
    expect(slice.deviceId).toBeNull();
    expect(slice.fcmToken).toBeNull();
    expect(slice.notificationsEnabled).toBe(false);
  });

  it('setDeviceRegistration stores deviceId and fcmToken', () => {
    const slice = makeSlice();
    slice.setDeviceRegistration({ deviceId: 'dev-1', fcmToken: 'tok-1' });
    expect(slice.deviceId).toBe('dev-1');
    expect(slice.fcmToken).toBe('tok-1');
  });

  it('setNotificationsEnabled(true) enables notifications', () => {
    const slice = makeSlice();
    slice.setNotificationsEnabled(true);
    expect(slice.notificationsEnabled).toBe(true);
  });

  it('setNotificationsEnabled(false) after true restores false', () => {
    const slice = makeSlice();
    slice.setNotificationsEnabled(true);
    slice.setNotificationsEnabled(false);
    expect(slice.notificationsEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/store/slices/device.test.ts`
Expected: FAIL — `setDeviceRegistration` is not a function / `deviceId` undefined.

- [ ] **Step 3: Implement the slice**

Replace `app/src/store/slices/device.ts` entirely:

```ts
import type { StateCreator } from 'zustand';

export interface DeviceSlice {
  deviceId: string | null;
  fcmToken: string | null;
  notificationsEnabled: boolean;
  setDeviceRegistration: (r: { deviceId: string; fcmToken: string }) => void;
  setNotificationsEnabled: (v: boolean) => void;
}

export const createDeviceSlice: StateCreator<DeviceSlice> = (set) => ({
  deviceId: null,
  fcmToken: null,
  notificationsEnabled: false,
  setDeviceRegistration: ({ deviceId, fcmToken }) => set({ deviceId, fcmToken }),
  setNotificationsEnabled: (v) => set({ notificationsEnabled: v }),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/store/slices/device.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/store/slices/device.ts app/src/tests/store/slices/device.test.ts
git commit -m "feat(app/store): expand device slice with identity fields"
```

---

## Task 6: Boot gate in the `app` slice

**Files:**

- Modify: `app/src/store/slices/app.ts`
- Test: `app/src/tests/store/slices/app.test.ts`

- [ ] **Step 1: Add the gate tests**

Append to `app/src/tests/store/slices/app.test.ts` (inside the file, after the existing `describe` block; the existing `makeStore` already returns only `AppSlice`):

```ts
describe('app slice — boot gate', () => {
  it('starts with flags down', () => {
    const s = makeStore().getState();
    expect(s.prefsHydrated).toBe(false);
    expect(s.deviceReady).toBe(false);
  });

  it('advances to ready only when prefs-loading AND both flags set', () => {
    const s = makeStore();
    s.getState().setAppState('prefs-loading');
    s.getState().setPrefsHydrated(true);
    expect(s.getState().appState).toBe('prefs-loading'); // device not ready yet
    s.getState().setDeviceReady(true);
    expect(s.getState().appState).toBe('ready');
  });

  it('does not advance from auth-check even with both flags set', () => {
    const s = makeStore();
    s.getState().setAppState('auth-check');
    s.getState().setPrefsHydrated(true);
    s.getState().setDeviceReady(true);
    expect(s.getState().appState).toBe('auth-check');
  });

  it('maybeAdvanceToReady is a no-op when already unauthenticated', () => {
    const s = makeStore();
    s.getState().setAppState('unauthenticated');
    s.getState().setPrefsHydrated(true);
    s.getState().setDeviceReady(true);
    s.getState().maybeAdvanceToReady();
    expect(s.getState().appState).toBe('unauthenticated');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/store/slices/app.test.ts`
Expected: FAIL — `setPrefsHydrated` is not a function.

- [ ] **Step 3: Implement the gate**

Replace `app/src/store/slices/app.ts` entirely:

```ts
import type { StateCreator } from 'zustand';
import type { AppState } from '../../types';

export type { AppState };

export interface AppSlice {
  appState: AppState;
  /** True once local preferences have hydrated from MMKV. */
  prefsHydrated: boolean;
  /** True once device registration resolved — success, denial, OR timeout. */
  deviceReady: boolean;
  setAppState: (state: AppState) => void;
  setPrefsHydrated: (v: boolean) => void;
  setDeviceReady: (v: boolean) => void;
  /** Transition prefs-loading → ready once both boot inputs are satisfied. */
  maybeAdvanceToReady: () => void;
}

export const createAppSlice: StateCreator<AppSlice> = (set, get) => ({
  appState: 'booting',
  prefsHydrated: false,
  deviceReady: false,
  setAppState: (appState) => set({ appState }),
  setPrefsHydrated: (prefsHydrated) => {
    set({ prefsHydrated });
    if (prefsHydrated) get().maybeAdvanceToReady();
  },
  setDeviceReady: (deviceReady) => {
    set({ deviceReady });
    if (deviceReady) get().maybeAdvanceToReady();
  },
  maybeAdvanceToReady: () => {
    const { appState, prefsHydrated, deviceReady } = get();
    if (appState === 'prefs-loading' && prefsHydrated && deviceReady) {
      set({ appState: 'ready' });
    }
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/store/slices/app.test.ts`
Expected: PASS (existing 8 + 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/store/slices/app.ts app/src/tests/store/slices/app.test.ts
git commit -m "feat(app/store): add boot gate so device registration co-gates ready"
```

---

## Task 7: `navigateToDigest` + refresh nonce on the `nav` slice

**Files:**

- Modify: `app/src/store/slices/nav.ts`
- Test: `app/src/tests/store/slices/nav.test.ts`

- [ ] **Step 1: Add the test**

Append to `app/src/tests/store/slices/nav.test.ts` a new describe block (the file already builds a standalone nav slice — match its existing `makeStore`/setup helper; the snippet below assumes a `create`-based store like `app.test.ts`):

```ts
describe('navigateToDigest', () => {
  it('sets digest screen, resets day index, and bumps the refresh nonce', () => {
    const s = makeStore();
    s.getState().setScreen('settings');
    s.getState().setDayIndex(3);
    const before = s.getState().digestRefreshNonce;
    s.getState().navigateToDigest();
    expect(s.getState().screen).toBe('digest');
    expect(s.getState().dayIndex).toBe(0);
    expect(s.getState().digestRefreshNonce).toBe(before + 1);
  });
});
```

> If `nav.test.ts` has no `makeStore` helper, add one mirroring `app.test.ts`:
>
> ```ts
> import { create } from 'zustand';
> import { createNavSlice, type NavSlice } from '../../../store/slices/nav';
> function makeStore() {
>   return create<NavSlice>()((...a) => ({ ...createNavSlice(...a) }));
> }
> ```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/store/slices/nav.test.ts`
Expected: FAIL — `navigateToDigest` is not a function.

- [ ] **Step 3: Implement on the nav slice**

In `app/src/store/slices/nav.ts`:

1. Add to the `NavSlice` interface (after `article` field and its setters):

```ts
  digestRefreshNonce: number;
  navigateToDigest: () => void;
```

2. Add to the initial state object (after `article: null,`):

```ts
  digestRefreshNonce: 0,
```

3. Add the action (after `setArticle`):

```ts
  navigateToDigest: () => {
    set({ screen: 'digest', dayIndex: 0, digestRefreshNonce: get().digestRefreshNonce + 1 });
    get().persistNavState();
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/store/slices/nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/store/slices/nav.ts app/src/tests/store/slices/nav.test.ts
git commit -m "feat(app/store): add navigateToDigest action with refresh nonce"
```

---

## Task 8: Re-wire boot signalling in `usePreferences` + `useAuthInit`

**Files:**

- Modify: `app/src/hooks/usePreferences.ts`
- Modify: `app/src/hooks/useAuthInit.ts`
- Test: `app/src/tests/hooks/usePreferences.test.ts`
- Test: `app/src/tests/useAuthInit.test.ts`

- [ ] **Step 1: Update the failing tests first**

In `app/src/tests/hooks/usePreferences.test.ts`, add `deviceReady: true` to the `beforeEach` `useAppStore.setState({...})` call so the gate can fire (the existing assertions expect `appState` to reach `'ready'`):

```ts
useAppStore.setState({
  appState: 'prefs-loading',
  screen: 'digest',
  session: null,
  prefs: DEFAULT_PREFERENCES,
  prefsMutationCount: 0,
  prefsHydrated: false,
  deviceReady: true,
});
```

In `app/src/tests/useAuthInit.test.ts`, extend the `beforeEach` reset and add one gate test:

```ts
beforeEach(() => {
  useAppStore.setState({
    appState: 'auth-check',
    session: null,
    authReady: false,
    isPasswordRecovery: false,
    prefsHydrated: false,
    deviceReady: false,
  });
});
```

Add inside `describe('handleAuthReady', …)`:

```ts
it('advances straight to ready when prefs + device are already done', () => {
  useAppStore.setState({
    session: { user: { id: 'u1', email: 'a@b.com' } } as unknown as Session,
    prefsHydrated: true,
    deviceReady: true,
  });
  handleAuthReady(true);
  expect(useAppStore.getState().appState).toBe('ready');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest --config jest.config.cjs src/tests/hooks/usePreferences.test.ts src/tests/useAuthInit.test.ts`
Expected: FAIL — the new `useAuthInit` gate test fails (handleAuthReady doesn't call `maybeAdvanceToReady` yet), and `usePreferences` "ready" assertions fail because the hook still calls `setAppState('ready')` directly (passes today, but will break in step 3 until the gate path is wired — run after step 3 to confirm green).

- [ ] **Step 3: Update `usePreferences.ts`**

Replace the `setAppState` selector and its use:

1. Change line 20 from:

```ts
const setAppState = useAppStore((s) => s.setAppState);
```

to:

```ts
const setPrefsHydrated = useAppStore((s) => s.setPrefsHydrated);
```

2. In the hydration effect, change:

```ts
setPrefs(local ?? DEFAULT_PREFERENCES);
setAppState('ready');
log.info('hydration complete');
```

to:

```ts
setPrefs(local ?? DEFAULT_PREFERENCES);
setPrefsHydrated(true);
log.info('hydration complete');
```

3. Update the effect dependency array at the end of that effect from `[userId, flush]` — it does not reference `setPrefsHydrated` as a dep today because `setAppState` wasn't a dep either; keep it `[userId, flush]` (store actions are stable references in Zustand).

- [ ] **Step 4: Update `useAuthInit.ts`**

Replace the `handleAuthReady` function body:

```ts
export function handleAuthReady(authReady: boolean): void {
  if (!authReady) return;
  const { session, appState, setAppState, maybeAdvanceToReady } = useAppStore.getState();
  if (!session) {
    setAppState('unauthenticated');
    return;
  }
  // Prefs hydration can reach the flags before getSession resolves authReady.
  // Don't regress a machine already at 'ready'; otherwise enter prefs-loading
  // and immediately try to advance in case both boot inputs are already done.
  if (appState !== 'ready') setAppState('prefs-loading');
  maybeAdvanceToReady();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest --config jest.config.cjs src/tests/hooks/usePreferences.test.ts src/tests/useAuthInit.test.ts`
Expected: PASS (all existing + the new gate test).

- [ ] **Step 6: Commit**

```bash
git add app/src/hooks/usePreferences.ts app/src/hooks/useAuthInit.ts app/src/tests/hooks/usePreferences.test.ts app/src/tests/useAuthInit.test.ts
git commit -m "feat(app/boot): route prefs+device readiness through the store gate"
```

---

## Task 9: `useDeviceRegistration` store-writer hook

**Files:**

- Create: `app/src/hooks/useDeviceRegistration.ts`
- Test: `app/src/tests/hooks/useDeviceRegistration.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/tests/hooks/useDeviceRegistration.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';
import { useAppStore } from '../../store';
import { useDeviceRegistration } from '../../hooks/useDeviceRegistration';
import * as register from '../../notifications/register';
import * as fcm from '../../notifications/fcm';
import * as devices from '../../notifications/devices';

jest.mock('../../notifications/register');
jest.mock('../../notifications/fcm');
jest.mock('../../notifications/devices');

const mockRegister = register as jest.Mocked<typeof register>;
const mockFcm = fcm as jest.Mocked<typeof fcm>;
const mockDevices = devices as jest.Mocked<typeof devices>;

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    appState: 'prefs-loading',
    session: null,
    deviceId: null,
    fcmToken: null,
    notificationsEnabled: false,
    prefsHydrated: false,
    deviceReady: false,
  });
  mockRegister.registerForPushNotifications.mockResolvedValue({
    deviceId: 'dev-1',
    fcmToken: 'tok-1',
  });
  mockRegister.listenForTokenRefresh.mockReturnValue(jest.fn());
  mockFcm.getNotificationPermission.mockResolvedValue(true);
  mockDevices.linkDeviceToUser.mockResolvedValue(undefined);
  mockDevices.updateNotifyTime.mockResolvedValue(undefined);
});

it('writes registration + notificationsEnabled + deviceReady to the store', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceReady).toBe(true));
  expect(useAppStore.getState().deviceId).toBe('dev-1');
  expect(useAppStore.getState().fcmToken).toBe('tok-1');
  expect(useAppStore.getState().notificationsEnabled).toBe(true);
});

it('sets deviceReady true even when registration returns null', async () => {
  mockRegister.registerForPushNotifications.mockResolvedValue(null);
  mockFcm.getNotificationPermission.mockResolvedValue(false);
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceReady).toBe(true));
  expect(useAppStore.getState().deviceId).toBeNull();
  expect(useAppStore.getState().notificationsEnabled).toBe(false);
});

it('links the device to the user once a session and deviceId exist', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceId).toBe('dev-1'));
  useAppStore.setState({
    session: { user: { id: 'user-9' } } as unknown as Session,
  });
  await waitFor(() => expect(mockDevices.linkDeviceToUser).toHaveBeenCalledWith('dev-1', 'user-9'));
});

it('syncs notify_at once prefs are hydrated', async () => {
  renderHook(() => useDeviceRegistration());
  await waitFor(() => expect(useAppStore.getState().deviceId).toBe('dev-1'));
  useAppStore.setState({ prefsHydrated: true });
  await waitFor(() =>
    expect(mockDevices.updateNotifyTime).toHaveBeenCalledWith('dev-1', expect.any(String)),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/hooks/useDeviceRegistration.test.ts`
Expected: FAIL with `Cannot find module '../../hooks/useDeviceRegistration'`.

- [ ] **Step 3: Implement the hook**

`app/src/hooks/useDeviceRegistration.ts`:

```ts
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAppStore } from '../store';
import { config } from '../config';
import { registerForPushNotifications, listenForTokenRefresh } from '../notifications/register';
import { getNotificationPermission } from '../notifications/fcm';
import { linkDeviceToUser, updateNotifyTime } from '../notifications/devices';
import { getLogger } from '../logger';

const log = getLogger('useDeviceRegistration');

/**
 * Store-writer hook. Runs the FCM registration lifecycle on mount (with a
 * timeout guard so a slow Firebase call never blocks boot), keeps
 * `notificationsEnabled` live across foregrounds, links the device to the
 * signed-in user, and syncs notify_at when the preference changes. Writes
 * everything to the store; returns nothing.
 */
export function useDeviceRegistration(): void {
  // Registration lifecycle — runs once.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const { setDeviceRegistration, setNotificationsEnabled, setDeviceReady } =
      useAppStore.getState();

    log.info('starting device registration');
    const timer = setTimeout(() => {
      if (!cancelled) {
        log.warn(
          `device registration timed out after ${config.deviceRegistrationTimeoutMs}ms — continuing without push`,
        );
        setDeviceReady(true);
      }
    }, config.deviceRegistrationTimeoutMs);

    void (async () => {
      try {
        const reg = await registerForPushNotifications();
        if (cancelled) return;
        if (reg) {
          setDeviceRegistration(reg);
          unsubscribe = listenForTokenRefresh(reg.deviceId);
          log.info(
            `device registered: ${reg.deviceId.slice(0, 8)}… fcm=${reg.fcmToken.slice(0, 20)}…`,
          );
        } else {
          log.warn('device registration returned null — push permission denied or no FCM token');
        }
        const enabled = await getNotificationPermission();
        if (!cancelled) setNotificationsEnabled(enabled);
      } catch (e) {
        // Push is best-effort — registration failure must not crash the app.
        log.warn(`registerForPushNotifications threw: ${String(e)}`);
      } finally {
        clearTimeout(timer);
        if (!cancelled) setDeviceReady(true);
      }
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      getNotificationPermission()
        .then((enabled) => useAppStore.getState().setNotificationsEnabled(enabled))
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (unsubscribe) unsubscribe();
      sub.remove();
    };
  }, []);

  // Link device to the signed-in user.
  const userId = useAppStore((s) => s.session?.user.id ?? null);
  const deviceId = useAppStore((s) => s.deviceId);
  useEffect(() => {
    if (!userId || !deviceId) return;
    linkDeviceToUser(deviceId, userId).catch((e: unknown) =>
      log.warn(`linkDeviceToUser failed: ${String(e)}`),
    );
  }, [userId, deviceId]);

  // Sync notify_at when the preference changes (gated on hydration so the
  // default is never pushed before remote sync resolves).
  const prefsHydrated = useAppStore((s) => s.prefsHydrated);
  const notifyTime = useAppStore((s) => s.prefs.notifyTime);
  useEffect(() => {
    if (!deviceId || !prefsHydrated) return;
    updateNotifyTime(deviceId, notifyTime).catch((e: unknown) =>
      log.warn(`updateNotifyTime failed: ${String(e)}`),
    );
  }, [deviceId, prefsHydrated, notifyTime]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/hooks/useDeviceRegistration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useDeviceRegistration.ts app/src/tests/hooks/useDeviceRegistration.test.ts
git commit -m "feat(app/notifications): add useDeviceRegistration store-writer hook"
```

---

## Task 10: `useNotificationHandlers` hook

**Files:**

- Create: `app/src/hooks/useNotificationHandlers.ts`
- Test: `app/src/tests/hooks/useNotificationHandlers.test.ts`

- [ ] **Step 1: Write the failing test**

`app/src/tests/hooks/useNotificationHandlers.test.ts`:

```ts
import { renderHook } from '@testing-library/react-native';
import { useAppStore } from '../../store';
import { useNotificationHandlers } from '../../hooks/useNotificationHandlers';
import * as fcm from '../../notifications/fcm';

jest.mock('../../notifications/fcm');
const mockFcm = fcm as jest.Mocked<typeof fcm>;

beforeEach(() => {
  jest.clearAllMocks();
  mockFcm.registerNotificationHandlers.mockReturnValue(jest.fn());
  useAppStore.setState({ appState: 'prefs-loading' });
});

it('does not register handlers before ready', () => {
  renderHook(() => useNotificationHandlers());
  expect(mockFcm.registerNotificationHandlers).not.toHaveBeenCalled();
});

it('registers handlers once ready and navigates to digest on tap', () => {
  useAppStore.setState({ appState: 'ready' });
  const navSpy = jest.spyOn(useAppStore.getState(), 'navigateToDigest');
  renderHook(() => useNotificationHandlers());
  expect(mockFcm.registerNotificationHandlers).toHaveBeenCalledTimes(1);
  const onDigest = mockFcm.registerNotificationHandlers.mock.calls[0][0];
  onDigest();
  expect(navSpy).toHaveBeenCalled();
});

it('unsubscribes on unmount', () => {
  useAppStore.setState({ appState: 'ready' });
  const unsub = jest.fn();
  mockFcm.registerNotificationHandlers.mockReturnValue(unsub);
  const { unmount } = renderHook(() => useNotificationHandlers());
  unmount();
  expect(unsub).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/hooks/useNotificationHandlers.test.ts`
Expected: FAIL with `Cannot find module '../../hooks/useNotificationHandlers'`.

- [ ] **Step 3: Implement the hook**

`app/src/hooks/useNotificationHandlers.ts`:

```ts
import { useEffect } from 'react';

import { useAppStore } from '../store';
import { registerNotificationHandlers } from '../notifications/fcm';

/**
 * Registers FCM tap handlers once the boot machine reaches 'ready'. Gating on
 * 'ready' guarantees the killed-app initial notification fires after nav state
 * is restored, so a notification-driven digest navigation is not clobbered.
 * Handlers navigate via the store, so no navigation refs are needed.
 */
export function useNotificationHandlers(): void {
  const appState = useAppStore((s) => s.appState);
  useEffect(() => {
    if (appState !== 'ready') return;
    return registerNotificationHandlers(() => useAppStore.getState().navigateToDigest());
  }, [appState]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/hooks/useNotificationHandlers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useNotificationHandlers.ts app/src/tests/hooks/useNotificationHandlers.test.ts
git commit -m "feat(app/notifications): add useNotificationHandlers tap→digest hook"
```

---

## Task 11: Refetch the active digest page on nonce change

**Files:**

- Modify: `app/src/components/DigestPager.tsx`
- Test: `app/src/tests/components/DigestPager.nonce.test.tsx`

- [ ] **Step 1: Write the failing test**

`app/src/tests/components/DigestPager.nonce.test.tsx`:

```ts
import { renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import { useAppStore } from '../../store';
import { useDigestRefreshOnNonce } from '../../components/DigestPager';
import type { DigestPageHandle } from '../../components/DigestPage';

beforeEach(() => {
  useAppStore.setState({ digestRefreshNonce: 0 });
});

it('does not refresh on initial mount', () => {
  const forceRefresh = jest.fn();
  renderHook(() => {
    const ref = useRef<DigestPageHandle | null>({ forceRefresh, openJumpModal: jest.fn() });
    useDigestRefreshOnNonce(ref);
  });
  expect(forceRefresh).not.toHaveBeenCalled();
});

it('refreshes the active page when the nonce increments', () => {
  const forceRefresh = jest.fn();
  const ref = { current: { forceRefresh, openJumpModal: jest.fn() } as DigestPageHandle };
  const { rerender } = renderHook(() => useDigestRefreshOnNonce(ref));
  useAppStore.setState({ digestRefreshNonce: 1 });
  rerender({});
  expect(forceRefresh).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest --config jest.config.cjs src/tests/components/DigestPager.nonce.test.tsx`
Expected: FAIL with `useDigestRefreshOnNonce is not a function` / export missing.

- [ ] **Step 3: Implement the effect as a small exported hook in DigestPager**

In `app/src/components/DigestPager.tsx`:

1. Ensure `useRef`/`useEffect` are imported (they already are) and add this exported hook above the `DigestPager` component definition:

```ts
export function useDigestRefreshOnNonce(
  activePageRef: React.RefObject<DigestPageHandle | null>,
): void {
  const nonce = useAppStore((s) => s.digestRefreshNonce);
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    activePageRef.current?.forceRefresh();
  }, [nonce, activePageRef]);
}
```

2. Call it inside the `DigestPager` component body (after the existing `usePageRefs` line):

```ts
useDigestRefreshOnNonce(activePageRef);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest --config jest.config.cjs src/tests/components/DigestPager.nonce.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/components/DigestPager.tsx app/src/tests/components/DigestPager.nonce.test.tsx
git commit -m "feat(app/digest): refresh active page on navigateToDigest nonce"
```

---

## Task 12: Mount the hooks in `App.tsx`

**Files:**

- Modify: `app/App.tsx`

- [ ] **Step 1: Add imports**

After the existing `import { usePreferences } from './src/hooks/usePreferences';` line, add:

```ts
import { useDeviceRegistration } from './src/hooks/useDeviceRegistration';
import { useNotificationHandlers } from './src/hooks/useNotificationHandlers';
```

- [ ] **Step 2: Mount the hooks**

In the `App` component body, immediately after the existing `usePreferences();` call, add:

```ts
useDeviceRegistration();
useNotificationHandlers();
```

- [ ] **Step 3: Typecheck + run the full app suite**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npx jest --config jest.config.cjs`
Expected: PASS — all suites green, including the existing App render tests (`App.openArticle.test.tsx`). If an existing App test renders `<App />` and now hits the firebase import, add `jest.mock('@react-native-firebase/messaging', …)` + `jest.mock('expo-notifications', …)` + `jest.mock('../notifications/register', …)` to that test file mirroring Task 3/Task 9 mocks. (App tests that render `RootScreens` directly are unaffected.)

- [ ] **Step 4: Commit**

```bash
git add app/App.tsx
git commit -m "feat(app): mount device registration + notification handlers"
```

---

## Task 13: Record deferrals + final verification

**Files:**

- Modify: `todo.md`

- [ ] **Step 1: Append the deferred items to `todo.md`**

Add under the post-parity / V2 section (create a `## Slice 6 deferrals` heading if no suitable section exists):

```markdown
## Slice 6 (app/notifications) deferrals

- Replace the publishable-key direct `devices` upsert with a `register-device`
  Supabase Edge Function backed by the secret key (RLS hardening). Carried from
  legacy `register.ts`.
- iOS push support: re-introduce the stripped `registerDeviceForRemoteMessages`
  / provisional-permission paths if/when an iOS target is added.
- Evaluate registering FCM tap handlers exactly once (vs. on each `ready`
  re-entry) if re-login churn ever causes a stale initial-notification re-navigation.
```

- [ ] **Step 2: Full verification pass**

Run (from `app/`):

```bash
npx tsc --noEmit
npx eslint --ext .ts,.tsx src
npx jest --config jest.config.cjs
```

Expected: all three PASS / clean. Then from repo root:

```bash
npm run format:check
```

Expected: PASS (the pre-commit hook also formats staged files).

- [ ] **Step 3: Commit**

```bash
git add todo.md
git commit -m "docs: record slice 6 deferrals in todo.md"
```

---

## Task 14: Review + PR

- [ ] **Step 1: Code review pass**

Run the `/code-review` skill against the branch diff. Fix findings on the branch (additional commits). This is the `/review` pass before security review.

- [ ] **Step 2: Security review pass**

Run the `/security-review` skill — this slice touches notifications, Supabase `devices` writes, and the deep-link surface. Focus areas: the publishable-key direct write (known MVP posture — confirm no new exposure), notification `data.type` handling, and that no token/PII is logged at full length (the modules log only `slice(0, 8/20)` prefixes — verify).

- [ ] **Step 3: Open the PR to `develop`**

```bash
git push -u origin feat/app-notifications
```

Open a PR targeting `develop` (confirm the base branch). PR description must link the four legacy files: `notifications/register.ts`, `hooks/useDeviceRegistration.ts`, `hooks/useAppServices.ts`, `hooks/useAppNavigation.ts`, and note that the deep-link/recovery third of the slice was completed in the auth-flow slice.

---

## Self-review notes (verified against the spec)

- **Spec §2.1 fcm.ts** → Task 3. **§2.2 devices.ts** → Task 2. **§2.3 register.ts** → Task 4. **keys.ts** → Task 2.
- **§3.1 device slice** → Task 5. **§3.2 nav navigateToDigest + nonce** → Task 7 (+ Task 11 consumer). **§3.3 boot gate** → Task 6 (+ Task 8 rewiring).
- **§4.1 useDeviceRegistration** → Task 9 (registration lifecycle, link, notify-time). **§4.2 useNotificationHandlers** → Task 10. App wiring → Task 12.
- **§5 testing** → tests in Tasks 2–11; native-reality caveat captured in Task 12 Step 3 and Task 14.
- **§6 PR workflow** → Task 14 (`/code-review` then `/security-review`). **§7 deferrals** → Task 13.
- **Type/name consistency:** `setDeviceRegistration`, `setNotificationsEnabled`, `setDeviceReady`, `setPrefsHydrated`, `maybeAdvanceToReady`, `navigateToDigest`, `digestRefreshNonce`, `getNotificationPermission`, `onFcmTokenRefresh`, `listenForTokenRefresh`, `registerForPushNotifications`, `registerNotificationHandlers`, `upsertDevice`, `linkDeviceToUser`, `updateNotifyTime`, `useDigestRefreshOnNonce` — used identically across defining and consuming tasks.
- **Decision on `deviceReady` location:** the spec (§3.3 note) left this to the plan; placed on the **app slice** (boot machine) so `maybeAdvanceToReady` reads it via the app-slice `get()` with no cross-slice generic typing. The device slice holds identity only.
