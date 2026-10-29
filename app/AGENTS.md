# app/

## What this package does

React Native (Expo) app, Android-first. Fetches daily digests from Supabase on notification tap. One push notification per day.

## Dev commands

```bash
cd app
npx tsc --noEmit
npx eslint --ext .ts,.tsx src
npm test
npx expo start --dev-client
npx expo run:android
```

## Expo gotchas

- Use `expo-linking` (not RN core `Linking`) for all deep links.
- `AsyncStorage` is `@react-native-async-storage/async-storage`, not a core import.
- Navigation: **manual conditional rendering** driven by Zustand `nav` slice. No React Navigation for V1.
- FCM: `@react-native-firebase/messaging` (native module). Expo Go will not work.

## Android only

Do not add iOS-specific code. `ios/` directory is not committed.
`google-services.json` must be at `app/android/app/google-services.json` for FCM.

## Test strategy

Test hooks and pure utilities with Jest + ts-jest (no renderer).
Component tests use `@testing-library/react-native` + `jest-expo`.
Skip snapshot tests on presentation components.
Target 60–70% on: auth state, deep link parsing, digest data transformation.
