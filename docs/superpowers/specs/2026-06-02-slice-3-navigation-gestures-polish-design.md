# Slice 3 — Navigation, gestures & UI polish

Date: 2026-06-02
Status: Approved — ready for implementation plan

Post-parity V1 polish. Interaction, navigation, and visual fixes. One PR to `develop`.

---

## 1. Source ↔ open-icon spacing on digest entries (incl. global)

**Files:** `app/src/components/GlobalSection.tsx`

- `RegionSection.sourceRow` already has `gap: 5` between the source name and the link icon; `GlobalSection.sourceRow` is `{ flexDirection:'row', alignItems:'center' }` with **no gap**, so the source name and link icon touch.
- Fix: add `gap: 5` to `GlobalSection`'s `sourceRow` style so global top-headline entries match the regional headlines and the article screen.
- `RegionSection` and `ArticleScreen` are the reference spacing and are unchanged.

## 2. Android system nav-bar regression

**Files:** `app/App.tsx`

- Regression: legacy `App.tsx` called `NavigationBar.setVisibilityAsync('hidden')` on mount; the rebuild keeps the `expo-navigation-bar` dependency but dropped the call, so the Android nav buttons now show by default.
- Fix: in `App`, on mount (Android only), restore:
  - `NavigationBar.setVisibilityAsync('hidden')` — hide the buttons by default.
  - `NavigationBar.setBehaviorAsync('overlay-swipe')` — so a swipe from the edge temporarily reveals them (the "swipe to bring up" behavior), matching legacy feel.
- Guard with `Platform.OS === 'android'`; no-op elsewhere. iOS untouched.

## 3. Screen-switch logging

**Files:** `app/src/store/slices/nav.ts`

- The nav slice logs restore/persist/TTL events but `setScreen` and `navigateToDigest` log nothing, so screen transitions are silent. Legacy logged them.
- Fix: in `setScreen`, read the current screen before `set` and emit a gentle line, e.g. `log.debug(\`screen \${prev} → \${screen}\`)`. Add a matching line to `navigateToDigest` (`log.debug('screen → digest (notification)')`). Use existing `getLogger('nav')`; `info`/`debug` level per the gentleness intent.

## 4. Swipe right→left on Today opens Settings

**Files:** `app/src/components/DigestPager.tsx`

- Today is `dayIndex === 0`; the RNGH pan gesture is bounded at `rightBound = 0`, so a left (right→left) swipe on Today currently does nothing.
- Fix: in the pan gesture's `onEnd`, when `dayIndex === 0` and the release is a left swipe past the existing distance/velocity threshold (the same `target` math that would try to go "newer" but is clamped at 0), call `runOnJS(onOpenSettings)()` instead. `onOpenSettings` is already a prop (sets `screen: 'settings'`); `SettingsScreen` then plays its existing `useSlideIn` entrance — same animation as the settings button.
- Extract the swipe outcome into a pure helper for testability, e.g. `resolveSwipe({ dayIndex, dx, vx, maxDayIndex })` → `'older' | 'newer' | 'open-settings' | 'none'`, and have `onEnd` dispatch on its result. Keeps the gesture worklet thin and the decision unit-testable.
- Day-to-day navigation (older/newer) and bounds are otherwise unchanged.

---

## Testing

Logical/structural coverage, not pixel snapshots:

- `resolveSwipe` helper: left swipe at `dayIndex 0` → `'open-settings'`; left swipe at `dayIndex > 0` → `'newer'`; right swipe → `'older'`; sub-threshold → `'none'`; respects `maxDayIndex` clamp.
- `nav.setScreen` emits a transition log (spy on the logger) and still persists; `navigateToDigest` logs and resets to digest/day 0.
- Android nav-bar effect calls `NavigationBar.setVisibilityAsync('hidden')` (and `setBehaviorAsync('overlay-swipe')`) on Android, and is a no-op when `Platform.OS !== 'android'` (mock `expo-navigation-bar`).
- Skip visual tests for the `GlobalSection` gap (pure presentation).

`/code-review` before the PR. No `/security-review` (no auth/notifications/API/deep-link changes).

## Out of scope

- The broader Android gesture/system-back conflict work (RNGH pan vs edge-swipe-back) tracked separately under todo.md "Behaviour".
- Swipe sensitivity tuning (separate todo item).
- Any change to `useSwipe.ts` (Settings dismiss) or `SettingsScreen`'s slide-in.
