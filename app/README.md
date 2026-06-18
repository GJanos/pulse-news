# Pulse News — Mobile App (Expo + React Native)

Android-first. Reads daily digests from Supabase, displays them by region, and receives one push notification per day via FCM.

---

## Prerequisites

- Node.js 20+, Android Studio / SDK
- A physical Android device or emulator
- Firebase project with `google-services.json`
- Supabase project with the schema from `supabase/schema.sql` applied

---

## Install

```bash
cd app
npm install
```

---

## Environment variables

Copy `.env.example` to `.env` inside `app/` and fill in:

| Variable                   | Description                     |
| -------------------------- | ------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL            |
| `EXPO_PUBLIC_SUPABASE_KEY` | Supabase publishable (anon) key |

FCM config lives in `app/google-services.json` (referenced from `app.json` as `./google-services.json`), not env vars. The file is gitignored — never commit it.

---

## Connecting your phone (every session)

Wireless debugging port changes each session. Use the helper script:

```bash
./scripts/adb-connect.sh
```

Or manually — check the port in Settings → Developer Options → Wireless debugging, then:

```bash
adb connect <phone-ip>:<connection-port>
adb devices   # should list <phone-ip>:<port>  device
```

---

## Running

This app uses native modules (`@react-native-firebase/messaging`), so **Expo Go will not work** — a custom dev client is required.

```bash
cd app
npx expo prebuild               # generate /android (one-time)
npx expo run:android            # first native build + install
npx expo start --dev-client     # subsequent runs — scan QR in the installed dev client
```

---

## Dev commands

```bash
npm run build     # tsc --noEmit (typecheck)
npm run lint      # ESLint on src/
npm test          # Jest
```

---

## Navigation

No React Navigation. The root `App.tsx` conditionally renders screens based on the Zustand `nav` slice (`splash` / `digest` / `settings` / `login`), gated by an `appState` machine (`booting` → `prefs-loading` → `ready`, plus `maintenance` and `update-required` stub screens). Nav state (screen + day index) persists to MMKV with a TTL; the open article is transient.

---

## Data flow

**Digests:** cache-first (MMKV) with a configurable stale window for today. Notification tap forces a full remote fetch. Past dates are immutable — never re-fetched.

**Auth:** `useSupabaseAuth` manages session via Supabase. MMKV persists the session across restarts.

**Deep links:** handled in `useDeepLinkRecovery` via `expo-linking` — both cold-start (`Linking.getInitialURL()`) and warm (`addEventListener('url', …)`). Two schemes are recognized: `pulse://reset-password` (password recovery → routes to the reset screen) and `pulse://confirm` (sign-up confirmation → establishes the session, which routes into the app). Each is exchanged via PKCE (`exchangeCodeForSession`) or implicit token flow (`setSession`) depending on what Supabase sends. Duplicate URLs are de-duped.

**Preferences:** keyed on `session.user.id`. Local writes are immediate. Supabase push is batched — flushed on settings close and on app background.

**Device registration:** Stable UUID on first launch, FCM token upserted to Supabase `devices`. Token rotation is handled by `onTokenRefresh`. After login, `user_id` is stamped on the device row.

---

## Building for stores

```bash
eas build -p android
```
