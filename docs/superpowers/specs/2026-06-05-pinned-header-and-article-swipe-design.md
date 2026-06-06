# Design — Pinned Header & Finger-Tracking Article Swipe

**Date:** 2026-06-05
**Status:** Approved (design phase)
**Ships as:** two focused PRs to `develop`

> This is one of two specs from the same brainstorming round. The in-app
> WebView reader (originally "PR 3") is a genuine feature and gets its own
> spec: `2026-06-05-in-app-webview-reader-design.md`. This spec covers only
> the two well-understood polish items.

---

## Context & goals

The digest experience uses a manual, gesture-driven navigation model (no
React Navigation). Two rough edges remain after slice 3:

1. **The top header line slides on every horizontal digest swipe** even
   though it never changes (Pulse wordmark + jump-to-day icon + settings
   icon are identical on every day). It should stay visually pinned.
2. **The article overlay uses a fixed slide animation** (`useSlideIn`) and a
   release-only `PanResponder` (`useSwipe`). It does not track the finger,
   so closing an article feels different from swiping between digests. The
   app should feel uniform: the close gesture should drag 1:1 with the
   finger and reveal the digest beneath during the drag.

Item 1 from the original todo (lock vertical orientation) is **already
satisfied** by `"orientation": "portrait"` in `app.json` — no work.

**Success criteria**

- Header top line is visually fixed across day↔day swipes; it fades out so
  the settings page shows **no header at all**.
- Closing the article drags 1:1 with the finger, reveals the digest beneath,
  and snaps closed past a threshold (else snaps back).
- The OS back-gesture collision on the screen edges is reduced (not
  eliminated — the OS caps what an app can exclude).
- All new decision logic lives in pure, unit-tested helpers.

---

## Scope

| PR  | Item                                                                  | Summary                                                                                                                                        |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Pinned header (todo item 2)                                           | Lift the unchanging top line out of the per-page header into a single pinned bar; fade it out over the settings segment.                       |
| 2   | Finger-tracking article close + edge mitigation (todo item 3a + shim) | Replace the fixed slide/PanResponder with a Reanimated `Pan` that tracks the finger; add a native gesture-exclusion shim for the screen edges. |

**Out of scope (separate spec):** the in-app WebView reader and its
swipe-back. In _this_ spec, swipe-left on the article keeps its current
behavior of opening the full article (the destination of that open is
redefined by the WebView spec, not here).

---

## PR 1 — Pinned top header

### Problem

`DigestPager` renders a horizontal, `pagingEnabled` `ScrollView` whose pages
are `[oldest day]…[today][settings]`. Each page renders a `DayHeader`
(`React.memo`) containing:

- `headerTop` — `PulseMark` + "Pulse / Daily" wordmark + jump-to-day icon
  (`list-ul`) + settings icon. **Identical on every page.**
- `navRow` — "Today / N days ago" + date + prev/next arrows. **Differs per
  page** (legitimately moves with the swipe).

Because `headerTop` lives inside each page, it slides with every swipe.

### Approach

Render `headerTop` **once**, as a single absolutely-positioned bar layered
over the pager, and keep `navRow` inside each page. Each page gets top
padding equal to the bar height so content clears it.

To make the bar disappear on the settings page (which is just the rightmost
page in the same pager, present only for the transition effect), drive the
bar's opacity from the live horizontal scroll offset:

- Across day↔day segments → opacity `1`, fully fixed.
- Across the final `today → settings` segment → fade `1 → 0` and set
  `pointerEvents: 'none'` once faded, so settings is visually and
  interactively headerless.

This requires continuous scroll tracking, which the current
`onMomentumScrollEnd`-only pager does not provide. Convert the pager to a
Reanimated `Animated.ScrollView` with `useAnimatedScrollHandler`, feeding a
shared value `scrollX`. The existing `onMomentumScrollEnd` paging/commit
logic is preserved unchanged (the two coexist).

### Pure helper

```
headerOpacityForScrollX(x: number, settingsPage: number, width: number): number
```

- Returns `1` while `x` is within any day page.
- Returns a linear `1 → 0` ramp across the last page-width before
  `settingsPage * width`.
- Clamps to `[0, 1]`.
- Marked as a Reanimated worklet (consistent with the existing
  `resolveSwipe` worklet introduced in slice 3) so it runs on the UI thread.

The bar's `pointerEvents` flips to `'none'` when opacity is below a small
epsilon (e.g. `< 0.02`).

### Components after the change

- **`PinnedHeaderBar`** (new, small): renders the former `headerTop`
  content; positioned absolutely; `opacity`/`pointerEvents` driven by
  `scrollX`. One clear purpose: the fixed brand/controls line.
- **`DayHeader`** (modified): drops `headerTop`, keeps `navRow` only.
- **`DigestPager`** (modified): owns `scrollX`, renders `PinnedHeaderBar`
  above the `Animated.ScrollView`, applies top padding to pages.

### Edge cases

- `showSettings = dayIndex === 0 || screen === 'settings'`: when the
  settings page is not present (more than one day available and not on
  settings), the fade segment simply never reaches 0 because the pager can't
  scroll there — the helper still returns `1` for all reachable offsets.
- Safe-area top inset: the pinned bar owns the top inset padding that
  `headerTop` previously had.
- Theming: the bar reads the same theme/aesthetic selectors the header used.

---

## PR 2 — Finger-tracking article close + edge mitigation

### Problem

`ArticleScreen` is an `Animated.View` over the digest (`zIndex: 100`,
`StyleSheet.absoluteFill`), animated by `useSlideIn` (`Animated.timing`,
non-interactive) and a release-only `useSwipe` (`PanResponder`). Closing
does not track the finger and does not reveal the digest during the drag, so
it feels unlike the digest pager.

Additionally, the Android OS back gesture on the screen edges can fire
mid-swipe; because `App.tsx`'s `BackHandler` closes the article on back,
an edge swipe intended for the app can yank the user to the digest.

### Approach — finger-tracking close

Replace `useSlideIn` + `useSwipe` on the article with a single
`react-native-gesture-handler` `Pan` driving a Reanimated `translateX`
shared value:

- **Drag right (close direction):** `translateX` follows the finger 1:1
  (clamped `≥ 0`). The digest pager is already mounted beneath the article
  in `RootScreens` (both render together), so it is revealed live during the
  drag — no extra wiring needed.
- **Release:** decide via the pure helper below. `close` → animate
  `translateX → width` then call `onClose`. `stay` → spring back to `0`.
- **Drag left (open direction):** `translateX` clamps at `0` (no visual
  movement); on release past threshold, fire the open-full-article action.
  _(Where "open" lands is defined by the WebView spec; here it stays the
  current `openExternalUrl`/open action.)_
- **Entry:** keep a slide-in on mount (Reanimated `withTiming` `width → 0`),
  matching today's feel.

The gesture uses `activeOffsetX` / `failOffsetY` so vertical scrolling in
the article body is not captured.

### Pure helper

```
resolveArticleSwipe(dx: number, vx: number): 'open' | 'close' | 'stay'
```

- `close` when `dx > DISTANCE || vx > VELOCITY` (rightward).
- `open` when `dx < -DISTANCE || vx < -VELOCITY` (leftward).
- `stay` otherwise.
- Reuses the existing thresholds (`DISTANCE = 48`, `VELOCITY = 0.45`) so
  feel is unchanged; marked as a worklet, invoked from the `Pan` `onEnd`,
  with side effects dispatched via `runOnJS`.

This same helper is reused by the WebView reader's back-swipe (other spec).

### Retiring the old hooks

`useSlideIn` and `useSwipe` are used **only** by `ArticleScreen`. Once the
`Pan` replaces them, delete both hooks and their tests. (Confirm no other
importers during planning; grep showed none.)

### Edge mitigation — native gesture-exclusion shim

There is no JS/Expo API for `View.setSystemGestureExclusionRects`, so add a
small native shim (the app already uses a custom dev-client, so a local
native module is fine):

- **`gesture-exclusion` native module** exposing
  `setEdgeExclusion(enabled: boolean)`.
- When enabled, it applies exclusion rects to the activity's decor/root view
  along the **left and right edges**, height clamped to the OS cap
  (~200 dp per edge, API 29+); when disabled, it clears them. No-op below
  API 29 and on iOS.
- `ArticleScreen` calls `setEdgeExclusion(true)` on mount and
  `setEdgeExclusion(false)` on unmount. (The WebView reader will reuse the
  same module.)

**Accepted limitation:** the OS caps exclusion at ~200 dp per edge, so a
swipe started outside that band can still trigger system back. This reduces,
not eliminates, the collision — as agreed.

### Edge cases

- Gesture vs. vertical scroll: `failOffsetY` ensures the article's
  `ScrollView` keeps vertical scrolling.
- Rapid flings: velocity branch in `resolveArticleSwipe` covers short, fast
  swipes.
- Unmount mid-animation: cancel any running animation / guard `onClose` so
  it fires once.

---

## Testing

Thorough where it pays off; pure logic fully covered.

| Target                         | Type                       | Cases                                                                                   |
| ------------------------------ | -------------------------- | --------------------------------------------------------------------------------------- |
| `headerOpacityForScrollX`      | unit                       | day pages → 1; ramp across final segment; clamp `[0,1]`; pointerEvents epsilon boundary |
| `resolveArticleSwipe`          | unit                       | distance + velocity for both directions; neutral → `stay`; boundary values              |
| `gesture-exclusion` JS binding | unit                       | `setEdgeExclusion(true/false)` calls the native module; iOS/old-API no-op path          |
| Settings page headerless       | component (RNTL, optional) | settings page renders no header content                                                 |

Native side of the shim has no JS test harness → verified manually on a
device (swipe near edges with/without exclusion). Reanimated/RNGH gesture
wiring is validated manually on-device.

---

## Risks & tradeoffs

- **Reanimated v4 + RNGH worklet correctness.** Mitigated by following the
  existing slice-3 `resolveSwipe` worklet pattern and keeping all decision
  logic in pure worklet helpers with `runOnJS` for side effects.
- **Pager conversion to `Animated.ScrollView`.** Paging and the existing
  `onMomentumScrollEnd` commit logic must be preserved; the animated scroll
  handler only _reads_ `x`. Low risk, but the main manual-test focus.
- **Edge exclusion is partial by OS design.** Documented and accepted.

---

## File touch list (indicative — confirm in planning)

- `app/src/components/DigestPager.tsx` — pinned bar, `scrollX`, animated
  scroll handler, page top padding.
- `app/src/components/PinnedHeaderBar.tsx` — **new**, the fixed top line.
- `DayHeader` component (currently inside the pager module) — drop
  `headerTop`, keep `navRow`.
- `app/src/screens/ArticleScreen.tsx` — `Pan` + Reanimated `translateX`;
  call `setEdgeExclusion` on mount/unmount.
- `app/src/hooks/useSlideIn.ts`, `app/src/hooks/useSwipe.ts` — **delete**.
- `app/src/utils/swipe.ts` (or similar) — **new**, `resolveArticleSwipe`
  (+ `headerOpacityForScrollX`, or a small `header.ts` helper).
- Native `gesture-exclusion` module + JS binding — **new**.
- Tests for the pure helpers and the JS binding.

---

## Non-goals

- No React Navigation.
- No change to the digest data model, day indexing, or settings content.
- No attempt to fully disable the Android system back gesture (impossible
  from an app).
