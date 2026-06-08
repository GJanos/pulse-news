# Spec: Swipe Fix + Article & Global Hero Images

**Date:** 2026-06-08
**Branch target:** `develop`
**Slice name:** `feat/swipe-hero-images`

---

## Scope

Three changes shipped together:

1. **Swipe sensitivity fix** — gesture misfires in the day-pager and article overlay
2. **ArticleScreen hero image** — full-bleed photo at the top of the article summary screen
3. **GlobalSection hero card** — single hero image for the #1 global headline

Out of scope: server-side image proxying, ArticleReader (WebView) hero, global headlines #2–N images, iOS-specific gesture work.

---

## 1. Swipe Sensitivity Fix

### Root causes

**DigestPager** uses `Animated.ScrollView` (React Native core) with `pagingEnabled`. The native gesture responder has no direction-angle threshold — any touch with a horizontal component can trigger day-switching even during a mostly-vertical scroll of the inner digest content.

**ArticleScreen** wraps the entire screen in an RNGH `GestureDetector` with a `Pan` gesture. The inner `ScrollView` is a React Native (non-RNGH) component, so it does not participate in RNGH's gesture coordination. The current `failOffsetY([-20, 20])` is too permissive: 20px of vertical movement is allowed before the gesture backs off, which is enough for a slightly diagonal vertical scroll to trigger dismiss or open.

### Changes

**`DigestPager.tsx`**

Replace the Reanimated `Animated.ScrollView` import with an Animated wrapper around RNGH's `ScrollView`:

```ts
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
const AnimatedPager = Animated.createAnimatedComponent(GHScrollView);
```

Use `<AnimatedPager>` in place of `<Animated.ScrollView>` — all existing props (`horizontal`, `pagingEnabled`, `onScroll`, `scrollEventThrottle`, `onMomentumScrollEnd`, `contentOffset`, `onLayout`, `ref`) transfer unchanged. RNGH's ScrollView participates in the gesture responder chain and yields to inner vertical scrolls when the touch direction is ambiguous.

**`ArticleScreen.tsx`**

Tighten the pan gesture: `failOffsetY([-20, 20])` → `failOffsetY([-10, 10])`. The gesture now fails if the touch moves 10px vertically before hitting the 15px horizontal activation threshold, eliminating diagonal-vertical-scroll triggering dismiss.

**`ArticleReader.tsx`**

Same tighten: `failOffsetY([-20, 20])` → `failOffsetY([-10, 10])`. The edge-strip constraint already limits exposure, but the threshold should be consistent.

No new dependencies — RNGH is already in the project.

---

## 2. ArticleScreen Hero Image

### Layout

`ArticleScreen`'s `ScrollView` has `contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 40 }}`. The hero image renders first, using negative margins to bleed to screen edges:

```
marginHorizontal: -22
marginTop: -22
height: 220
contentFit: "cover"
borderRadius: 0
```

The image scrolls away naturally with the rest of the content. After it, the existing layout (title → byline → summary → detail → buttons) is unchanged.

### Conditions

- Render if `headline.imageUrl` is truthy **and** `prefs.imagesEnabled` is `true`
- If either condition is false: layout is identical to today — no blank space, no regression

### Data

No changes to the `Headline` type or cron pipeline. `imageUrl` is already on the type and populated by cron's og:image extraction.

### Component

Uses the existing `HeadlineImage` wrapper (`expo-image` under the hood). No new component needed.

---

## 3. GlobalSection Hero Card

### Layout

When `headlines[0].imageUrl` is truthy and `prefs.imagesEnabled` is true, the first headline renders as a hero card:

```
Section header (globe icon + "Global Headlines")
──────────────────────────────────────────────
[full-bleed image, 200px tall, contentFit=cover]   ← new
──────────────────────────────────────────────
1  Title text
   Summary...
   Source · Region pill
──────────────────────────────────────────────
2  Title...    (unchanged)
3  Title...    (unchanged)
```

The image renders between the section header and headline #1's text content. Its horizontal margins counteract the section's `paddingHorizontal: 20` so it bleeds edge-to-edge within the card.

Headlines #2–N render exactly as before.

### Conditions

- Hero image shown only for index 0, only if `headlines[0].imageUrl` is truthy and `prefs.imagesEnabled` is true
- If either condition is false: `GlobalSection` renders identically to today

### Data

No cron changes. `rankGlobalHeadlines` already passes `imageUrl: h.imageUrl` through; `GlobalHeadline.imageUrl` is already on both the cron and app types.

---

## Testing

| Area                   | What to verify                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Swipe — pager          | Vertical scroll in digest does not accidentally switch days                               |
| Swipe — ArticleScreen  | Vertical scroll does not trigger dismiss or open; deliberate horizontal swipe still works |
| Swipe — ArticleReader  | Same as ArticleScreen from the left edge strip                                            |
| ArticleScreen hero     | Image renders when `imageUrl` present + images enabled; absent when either false          |
| ArticleScreen no image | Layout unchanged — no blank gap at top                                                    |
| GlobalSection hero     | Hero image renders for #1 only; #2–N unaffected                                           |
| GlobalSection no image | Section renders as before                                                                 |
| Images disabled        | Both hero surfaces hidden; no blank gaps                                                  |

Unit tests: update `ArticleScreen` and `GlobalSection` tests to cover the conditional image rendering paths.
