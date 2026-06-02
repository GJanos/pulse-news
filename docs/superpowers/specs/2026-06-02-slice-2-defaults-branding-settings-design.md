# Slice 2 — Defaults, branding & settings wiring

Date: 2026-06-02
Status: Approved — ready for implementation plan

Post-parity V1 polish. Defaults, branding, and Settings-screen wiring. One PR to `develop`.

---

## 1. App name → "Pulse News"

**Files:** `app/app.json`

- `expo.name`: `"Pulse"` → `"Pulse News"` (the installed/launcher label). `slug`, `android.package`, and `ios.bundleIdentifier` are unchanged.
- The in-app wordmark ("Pulse" + "Daily" eyebrow in `DigestPager`, and "Pulse" on `LoginScreen`) is a brand wordmark, not the OS name — left as-is.

## 2. Default theme → Dark

**Files:** `app/src/storage/preferences.ts` (+ tests that assert the default)

- `DEFAULT_PREFERENCES.theme`: `'light'` → `'dark'`.
- Update the existing default-asserting tests (`storage/preferences.test.ts`, `store/slices/prefs.test.ts`, and any `themes.test.ts` reference) to expect `'dark'`.
- The Settings "Theme" segmented control already offers Light/Sepia/Dark; only the default changes. Existing users keep their saved theme (hydration/merge precedence is unchanged).

## 3. App-start loading screen → Dark (by default)

**Files:** `app/App.tsx` (verification + small fallback tweak)

The cold-start chain is: native Expo splash (`#fafaf7`, the "splash screen" — left untouched) → `appState === 'booting'` blank `<View backgroundColor: theme.bg>` → `SplashScreenComponent` during `auth-check`/`prefs-loading`. Both JS views derive their background from `THEMES[prefs.theme]`, and before prefs hydrate the store holds `DEFAULT_PREFERENCES`. So once §2 flips the default to dark, the boot/loading views are dark by default automatically.

- Action: change the invalid-id fallback `THEMES[themeId] ?? THEMES.light` to `?? THEMES.dark`, so the loading background is dark even if `themeId` is ever unset/invalid.
- No change to the native splash (`app.json splash.backgroundColor`) — that is the splash screen, explicitly out of scope.

## 4. Clamp global headline count to cron config

**Files:** `app/src/config.ts`, `app/src/screens/SettingsScreen.tsx`, `app/src/hooks/useDigestPageData.ts` (+ tests)

The Settings "Global Headlines → Count" `Stepper` is hardcoded `max={10}`, but the cron only ranks `cron.api.ranking.global.count` (currently `5`) global stories — so the UI can request more than exist.

- `config.ts`: expose the cron value, e.g. `export const globalHeadlineMax = rawConfig.cron.api.ranking.global.count` (typed).
- `SettingsScreen`: set the global Count stepper `max={globalHeadlineMax}`.
- Defensive clamp: where the global count is consumed (`useDigestPageData` `visibleGlobalHeadlines` slice), clamp to `globalHeadlineMax` so a previously-stored larger value can't over-request. `DEFAULT_PREFERENCES.globalHeadlineCount` (5) already equals the cap.

## 5. Global-section stepper spacing

**Files:** `app/src/screens/SettingsScreen.tsx`

- The global Count `Stepper` uses the text variant (number `minWidth:34`), making the buttons sit far from the number. The "Headlines per region" stepper (`RegionPicker`) uses the `icons` variant (number `minWidth:18`, tighter).
- Add the `icons` prop to the global Count `Stepper` so it matches the per-region stepper's tight spacing. No change to `Stepper.tsx` itself.

## 6. Region label — keep `code`, nudge it left

**Files:** `app/src/components/RegionSection.tsx`

- Decision: keep both `regionStyle` options (`flag` + `code`). The Settings "Region label" control is unchanged.
- When `regionStyle === 'code'`, the section header renders the `codePill` (`width:36,height:22`). Apply a small negative left offset to the **code pill only** (e.g. `marginLeft: -3` on `s.codePill`) so the code sits a few px further left than the flag. The flag branch (`<Flag width={26}>`) is unchanged.

---

## Testing

Logical/structural coverage, not pixel snapshots:

- `DEFAULT_PREFERENCES.theme === 'dark'` (and the updated default-assertion tests pass).
- `globalHeadlineMax` resolves to the cron config value; the global-count clamp returns `min(stored, max)` — over-cap stored value is clamped, in-range value passes through.
- `app.json` `expo.name === 'Pulse News'` (simple config assertion is fine; optional).
- Skip snapshot/visual tests for the stepper `icons` variant and the code-pill offset (pure presentation).

`/code-review` before the PR. No `/security-review` (no auth/notifications/API/deep-link changes).

## Out of scope

- Native splash background / `SplashScreenComponent` redesign.
- Removing the `code` region-label option.
- Any change to `Stepper.tsx`'s internal layout.
