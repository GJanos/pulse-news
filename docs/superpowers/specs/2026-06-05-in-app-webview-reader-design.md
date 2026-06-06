# Design — In-App WebView Article Reader

**Date:** 2026-06-05
**Status:** Approved — spike-validated 2026-06-06 (🟢 go), ready to implement
**Ships as:** one focused PR to `develop` ("PR 3")
**Depends on:** `2026-06-05-pinned-header-and-article-swipe-design.md`
(reuses its `resolveArticleSwipe` helper and the `gesture-exclusion` native
shim).

> This spec is intentionally explanatory. It is the one genuine _feature_ in
> this brainstorming round, so it carries more background than its sibling.

---

## Why this exists (the wall we hit)

Today, "Read full article" hands the URL to Chrome via an **external Custom
Tab** (`expo-web-browser`). Chrome is a separate program; the app has no
control over it. That means a left-to-right swipe inside the article page
**cannot** mean "go back to my summary screen" — the screen isn't ours
anymore.

The user navigates by buttons and in-app gestures (not the Android system
back), and wants an **app-controlled** back motion from the full article
back to the summary — working whether or not Android gesture-nav is enabled.
The only way to own that gesture is to render the page **inside** the app
with [`react-native-webview`](https://github.com/react-native-webview/react-native-webview).
A WebView is an embedded browser surface we render as one of our own
components, so our gestures and back button drive it.

---

## The three-layer model

The reader is a third overlay, layered like the existing screens. Lower
layers stay mounted so a drag can reveal them live (the same technique the
digest pager and the article overlay already use).

```
Layer 3  WebView reader  (NEW)   ← full webpage, in-app, swipeable
Layer 2  ArticleScreen   summary ← headline + summary (your screen)
Layer 1  DigestPager     digest  ← the day's headlines
```

Flow:

1. Tap a headline → **Layer 2** (summary) over the digest.
2. Tap "Read full article" **or** swipe-left → **Layer 3** (reader) over the
   summary.
3. Back-swipe / back-button on Layer 3 → first steps back through the
   WebView's own page history; once at the original article, the next back
   exits the reader and reveals the summary beneath (finger-tracking).

This only applies in `openLinksIn: 'in-app'` mode. `'browser'` mode is
unchanged: a headline goes straight to an external Custom Tab and the
summary/reader are never shown.

---

## Spike validation (2026-06-06)

Before committing to this PR, a throwaway spike (`spike/webview-reader`,
since deleted) mounted a bare `react-native-webview` against **18 real,
recent article URLs** — one per domain, pulled from the live `digests` table
and ordered by how often Pulse actually serves each domain, with the seven
render-risk domains (reuters, jpost, scmp, independent, apnews, caixin,
politico) explicitly flagged.

Result: **🟢 go.**

- **Render quality:** every domain rendered effectively identically to
  Chrome — including the flagged paywall/consent sites. No blank pages, no
  WebView sniff-blocks, load times comparable to the external tab.
- **Consent banners:** ~5–6 sites showed a cookie-consent banner on first
  visit. Dismissing it sets the site's persistent consent cookie; the banner
  did **not** reappear on revisit, and the consent **persists across full app
  restarts** (verified on-device). For users this is a one-time toll per
  domain — a short burst across the ~18–20 domains Pulse rotates, then
  silent. New domains prompt once, then join the quiet set.
- **Version:** `react-native-webview@13.16.1` is the Expo SDK 56-compatible
  pin (`npx expo install react-native-webview`).

**Build implication:** keep the WebView's _default_ cookie behavior — do
**not** set `incognito` (it wipes the consent cookie on unmount and
re-triggers banners on every open), and leave `thirdPartyCookiesEnabled` at
its Android default of `true` (IAB TCF consent cookies are commonly
third-party). This is the difference between the one-time-per-domain toll
above and a banner on every single visit. See the cookie config under
`ArticleReader`.

---

## Architecture

### New dependency

`react-native-webview@13.16.1` (Expo SDK 56-compatible pin, confirmed by the
spike; install via `npx expo install react-native-webview`). It is a native
module, so the custom dev-client must be rebuilt after adding it.

### New component — `ArticleReader`

One clear purpose: render a URL in a WebView with app-controlled
navigation/back, plus loading and error handling.

```
ArticleReader({ url, onClose })
```

Responsibilities:

- Render a `WebView` (`source={{ uri: url }}`) filling the layer, with a
  Reanimated `translateX` for the slide-in and the interactive back drag.
- Hold a `ref` to the WebView and track `canGoBack` from
  `onNavigationStateChange`.
- A minimal top bar: source host + an **"Open in browser"** action
  (delegates to the existing `openExternalUrl`) as the escape hatch. No
  forward/reload chrome in V1.
- Loading and error states (below).
- **Cookie behavior — keep the defaults (load-bearing, see Spike
  validation):** no `incognito` prop, `thirdPartyCookiesEnabled` left at the
  Android default `true`, and `setSupportMultipleWindows={false}` so in-page
  `target=_blank` links load in place rather than being silently dropped.
  These are what make cookie-consent banners a one-time-per-domain event that
  survives restarts.

### State

Add to the store, mirroring the existing `article` field:

- `readerUrl: string | null` — the URL currently open in the reader (`null`
  = closed).
- `setReaderUrl(url | null)`.
- `readerCanGoBack: boolean` + `setReaderCanGoBack(b)` — updated by the
  reader from `onNavigationStateChange`, read by the global back handler.

`RootScreens` renders, above the article overlay:

```
{readerUrl && (
  <ArticleReader url={readerUrl} onClose={() => setReaderUrl(null)} />
)}
```

### Routing change

The only routing change is the destination of "open full article" while in
`in-app` mode:

- **`ArticleScreen` open action** (button + swipe-left): currently
  `openExternalUrl(headline.url)`. Change to `setReaderUrl(headline.url)`.
- `onOpenArticle` in `App.tsx` is **unchanged**: `'browser'` → external
  Custom Tab; `'in-app'` → show the summary (`setArticle`). The summary is
  only ever reached in `in-app` mode, so the reader is only reachable there.
- The in-reader "Open in browser" calls `openExternalUrl(url)` — the
  pressure valve for pages that misbehave in a WebView.

---

## Back behavior (browser-like, then exit)

Per the locked decision, back **exhausts in-page history first, then exits**.

A tiny pure helper makes the decision testable:

```
resolveReaderBack(canGoBack: boolean): 'goBack' | 'close'
```

- `canGoBack === true` → `'goBack'` (call `webViewRef.goBack()`).
- `canGoBack === false` → `'close'` (call `onClose()` → back to summary).

Two entry points use it:

1. **Hardware / system back** — `App.tsx` `BackHandler` gains a top rung:

   ```
   reader open? → resolveReaderBack(readerCanGoBack)
                    'goBack' → webview.goBack()      (return true)
                    'close'  → setReaderUrl(null)     (return true)
   summary open? → setArticle(null)                   (return true)
   settings?     → setScreen('digest')                (return true)
   else          → false
   ```

   The WebView's `goBack()` is imperative, so the reader registers its
   back action with the store on mount (e.g. `setReaderBack(fn | null)`),
   and `App.tsx` invokes it. (Wiring detail; behavior is the table above.)

2. **Left-edge back-swipe** — see gestures below.

So the physical back button and the swipe always agree, in this order:
**reader (in-page → exit) → summary → settings → digest.**

---

## Gestures (reusing PR 2's foundation)

The back-swipe is **left-edge-anchored** so it never fights horizontal
content inside the page (carousels, wide tables): the `Pan` only arms when
the touch begins within a narrow strip at the screen's left edge
(`activeOffsetX` + a hit-slop region). Drags starting mid-page scroll the
page normally.

On gesture start, read `readerCanGoBack`:

- **In-page history exists (`canGoBack`)** → the swipe is a **discrete**
  back: on release past the `resolveArticleSwipe` threshold, call
  `webViewRef.goBack()` and snap `translateX` back to `0`. No summary
  reveal — we're not leaving the reader.
- **At the root article (`!canGoBack`)** → the swipe is the **interactive**
  exit: `translateX` finger-tracks 1:1, revealing the summary beneath; on
  release, `close` (animate out → `onClose`) or `stay` (spring back to `0`),
  decided by the shared `resolveArticleSwipe(dx, vx)` helper from PR 2.

The interactive-reveal feel (the "like between digests" feel the user asked
for) applies to the exit step; deeper in history it's browser-like discrete
back, which is what users expect there.

### Edge-exclusion shim

Reuse PR 2's `gesture-exclusion` native module: the reader calls
`setEdgeExclusion(true)` on mount and `setEdgeExclusion(false)` on unmount,
reducing accidental OS back on the edges (same ~200 dp OS cap caveat).

---

## Loading & error states

The app now owns what Chrome used to handle:

- **Loading:** a centered spinner (themed) over the WebView until
  `onLoadEnd`.
- **Error** (`onError` / `onHttpError`, or a load timeout): a themed
  fallback card — short message + two actions: **Retry** and **Open in
  browser** (`openExternalUrl`).
- The top bar's "Open in browser" is always available regardless of state.

---

## Honest tradeoffs (documented, accepted)

A WebView is not Chrome:

- **Separate cookie jar** — Chrome logins/paywall sessions don't carry over;
  some paywalled pages look more locked-down. Mitigated by "Open in
  browser". A first-visit cookie-consent banner appears per domain, but the
  consent cookie persists (across restarts), so it's a one-time toll, not
  recurring — validated by the spike, see above.
- **No Chrome conveniences** — no reader mode, autofill, extensions.
- **Some sites sniff WebViews** and degrade or block embedding — escape
  hatch covers these.
- **Slightly heavier in-app** than launching an external tab.

None block the goal (app-controlled back). `'browser'` mode remains the
pressure valve for users who prefer the full Chrome experience globally.

---

## Testing

| Target                         | Type             | Cases                                                                                                                                                                                |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resolveReaderBack`            | unit             | `true → 'goBack'`; `false → 'close'`                                                                                                                                                 |
| `resolveArticleSwipe` (reused) | unit             | already covered by PR 2                                                                                                                                                              |
| Open routing                   | unit             | `in-app` open action dispatches `setReaderUrl`; `browser` mode untouched (extends existing `App.openArticle` tests)                                                                  |
| Global back precedence         | unit             | extract the back decision into a pure resolver: reader(goBack vs close) → summary → settings → digest → unhandled                                                                    |
| `ArticleReader` states         | component (RNTL) | loading spinner shown then hidden on load; error fallback renders Retry + Open-in-browser; `onNavigationStateChange` updates `readerCanGoBack`; **`react-native-webview` is mocked** |

WebView/gesture behavior on real sites is verified manually on-device
(in-page link → back steps through history → exits to summary; left-edge
swipe vs mid-page scroll; "Open in browser"; error fallback via airplane
mode).

---

## File touch list (indicative — confirm in planning)

- `app/package.json` — add `react-native-webview`; dev-client rebuild.
- `app/src/screens/ArticleReader.tsx` — **new** reader component.
- `app/src/store` (nav slice) — `readerUrl`, `setReaderUrl`,
  `readerCanGoBack`, `setReaderCanGoBack`, reader back-handler registration.
- `app/App.tsx` — render `ArticleReader`; extend `BackHandler` chain.
- `app/src/screens/ArticleScreen.tsx` — open action → `setReaderUrl` (in-app
  mode) instead of `openExternalUrl`.
- `app/src/utils/...` — `resolveReaderBack` helper (+ optional extracted
  back-precedence resolver).
- Tests for the helpers, routing, and the reader component.

---

## Non-goals

- No in-reader forward/reload chrome, downloads, or tab management (V1 is
  back + open-in-browser only).
- No change to `openLinksIn`'s two values; `'browser'` stays the global
  external option.
- No offline caching / reader-mode extraction.
- No React Navigation.

---

## Open items for planning

- ~~Confirm `react-native-webview` version pin matches the Expo SDK in
  use.~~ Resolved by the spike: `13.16.1` on Expo SDK 56.
- ~~Validate render quality on Pulse's real article domains.~~ Resolved by
  the spike: 🟢 go (see Spike validation).
- Decide the exact left-edge strip width for the back-swipe (tune
  on-device).
