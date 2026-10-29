# app/ — CLAUDE.md

## What this package does

React Native (Expo) app, Android-first. Fetches daily digests from Supabase on notification tap. One push notification per day.

## Dev commands

```bash
cd app
npx tsc --noEmit                    # typecheck
npx eslint --ext .ts,.tsx src       # lint
npm test                            # Jest (available after app/foundation)
npx expo start --dev-client         # dev server (after app/foundation)
npx expo run:android                # build + install on Android (after app/foundation)
```

## Module map (populated by slices)

| File                               | Role                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `App.tsx`                          | Root: font loading, screen routing; composes `useAppServices` + `useAppNavigation` |
| `src/types.ts`                     | Domain types (`Region`, `Headline`, `Digest`, `UserPreferences`, …)                |
| `src/config.ts`                    | Typed re-export of `pulse.config.json` + `API_URL` constant                        |
| `src/data.ts`                      | Re-exports `REGIONS` from `@shared`; `sortedSelectedRegions`, date helpers         |
| `src/themes.ts`                    | `THEMES`, `AESTHETICS`, `font()` helper                                            |
| `src/logger.ts`                    | Structured logger; level from `pulse.config.json`                                  |
| `src/supabase/client.ts`           | Lazy Supabase client; MMKV-backed session persistence                              |
| `src/storage/mmkv.ts`              | Shared MMKV instance                                                               |
| `src/storage/preferences.ts`       | MMKV cache + Supabase pull/push; conflict resolution via `updatedAt`               |
| `src/storage/digests.ts`           | Cache-first digest storage; stale window for today; immutable past dates           |
| `src/notifications/register.ts`    | FCM token + Supabase upsert; `linkDeviceToUser`; `registerNotificationHandlers`    |
| `src/hooks/useAppServices.ts`      | Aggregates auth + device + preferences + theme for `App.tsx`                       |
| `src/hooks/useAppNavigation.ts`    | Nav state + Android back + FCM routing + auth-gate redirects                       |
| `src/hooks/useSupabaseAuth.ts`     | Session management — sign in/up/out/reset/delete                                   |
| `src/hooks/useDeepLinkRecovery.ts` | `pulse://reset-password` PKCE + implicit token exchange                            |
| `src/hooks/useDigest.ts`           | Module-level cache + stale window + `forceRefresh`                                 |
| `src/hooks/useCurrencyRates.ts`    | jsDelivr/Cloudflare fallback; % change computation; module-level cache             |

## Expo gotchas

- Use `expo-linking` (not RN core `Linking`) for all deep links.
- `AsyncStorage` is `@react-native-async-storage/async-storage`, not a core import.
- Navigation: `@react-navigation/native-stack` — stack only, no tabs or drawer.
- FCM: `@react-native-firebase/messaging` (native module). Expo Go will not work.

## Android only

Do not add iOS-specific code. `ios/` directory is not committed.
`google-services.json` must be at `app/android/app/google-services.json` for FCM.

## Shared imports

```typescript
import type { Digest } from '@shared/types';
import { REGIONS } from '@shared/regions';
```

`@shared/*` → `../shared/src/*`. Configured in `tsconfig.json`; Jest alias added in `app/foundation`.

## Test strategy

Test hooks and pure utilities with Jest + ts-jest (no renderer).
Component tests use `@testing-library/react-native` + `jest-expo` (foundation slice).
Skip snapshot tests on presentation components.
Target 60–70% on: auth state, deep link parsing, digest data transformation.
