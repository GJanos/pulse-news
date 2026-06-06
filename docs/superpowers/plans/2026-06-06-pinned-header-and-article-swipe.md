# Pinned Header & Finger-Tracking Article Swipe — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the unchanging top header so it no longer slides on digest swipes (fading out over the settings page), and replace the article overlay's fixed slide/PanResponder with a finger-tracking Reanimated + gesture-handler close, plus a native Android edge-exclusion shim.

**Architecture:** Two independently shippable PRs to `develop`. PR 1 lifts the brand/controls line into a single absolutely-positioned `PinnedHeaderBar` whose opacity is driven by the live horizontal scroll offset of a Reanimated `Animated.ScrollView`. PR 2 rewrites `ArticleScreen` to drive a Reanimated `translateX` from a gesture-handler `Pan`, retires the `useSlideIn`/`useSwipe` hooks (cleaning up their other caller, `SettingsScreen`), and adds an Expo local native module for `setSystemGestureExclusionRects`. All decision logic lives in pure, unit-tested worklet helpers.

**Tech Stack:** React Native (Expo, Android-first), TypeScript, `react-native-reanimated` ^4.3.1, `react-native-gesture-handler` ^2.31.2, Zustand, Jest + ts-jest (node env, manual `__mocks__/`), Expo Modules API (Kotlin) for the native shim.

---

## Spec corrections discovered during planning

The source spec (`docs/superpowers/specs/2026-06-05-pinned-header-and-article-swipe-design.md`) contains two factual errors. This plan accounts for both:

1. **No existing `resolveSwipe` worklet.** The spec repeatedly cites a "slice-3 `resolveSwipe` worklet" as precedent. Grep across `app/src` finds zero worklets and zero `useAnimatedScrollHandler`/`Gesture.` usage; the slice-3 pager (commit `5a75966`) is a plain native paging `ScrollView` with `onMomentumScrollEnd`. Our helpers are the first worklets. No precedent to follow — we follow Reanimated v4 conventions directly.
2. **`useSlideIn`/`useSwipe` have a second caller.** The spec says they are "used only by `ArticleScreen` ... grep showed none." In fact `app/src/screens/SettingsScreen.tsx` imports and calls both (its non-embedded branch). That branch is dead in the live app (`RootScreens` always renders `SettingsScreen embedded`), but the calls are unconditional. **Task 11** cleans up `SettingsScreen` so the hooks can be safely deleted.

---

## File Structure

**PR 1 — Pinned header**

- `app/src/utils/header.ts` — **new.** Pure worklet helper `headerOpacityForScrollX` + `HEADER_FADE_EPSILON`. One responsibility: map scroll offset → header opacity.
- `app/src/tests/utils/header.test.ts` — **new.** Unit tests for the helper.
- `app/src/components/PinnedHeaderBar.tsx` — **new.** The fixed brand/controls line; absolutely positioned; opacity + pointerEvents driven by `scrollX`.
- `app/src/components/DigestPager.tsx` — **modify.** Convert outer pager to Reanimated `Animated.ScrollView`, own `scrollX`, render `PinnedHeaderBar`, strip `headerTop` from `DayHeader`, apply measured top padding to day pages.
- `app/__mocks__/react-native-reanimated.ts` — **modify.** Add `ScrollView`, `useAnimatedScrollHandler`, `useAnimatedProps`, `Easing` so rendered tests that mount the pager / article keep working.

**PR 2 — Finger-tracking close + edge mitigation**

- `app/src/utils/swipe.ts` — **new.** Pure worklet helper `resolveArticleSwipe` + reused thresholds.
- `app/src/tests/utils/swipe.test.ts` — **new.** Unit tests for the helper.
- `app/src/screens/ArticleScreen.tsx` — **modify.** `Pan` + Reanimated `translateX`; call `setEdgeExclusion` on mount/unmount.
- `app/src/screens/SettingsScreen.tsx` — **modify.** Drop `useSlideIn`/`useSwipe` (dead non-embedded animation) so the hooks can be deleted.
- `app/src/hooks/useSlideIn.ts`, `app/src/hooks/useSwipe.ts` — **delete.**
- `app/modules/gesture-exclusion/` — **new.** Expo local native module (`expo-module.config.json`, Kotlin module, JS binding `index.ts`).
- `app/__mocks__/expo-modules-core.ts` — **new.** Manual mock so the binding resolves under Jest.
- `app/jest.config.cjs` — **modify.** Map `expo-modules-core` to the manual mock.
- `app/src/tests/modules/gesture-exclusion.test.ts` — **new.** Unit tests for the JS binding.

---

# PR 1 — Pinned top header

### Task 1: `headerOpacityForScrollX` pure helper

**Files:**

- Create: `app/src/utils/header.ts`
- Test: `app/src/tests/utils/header.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/tests/utils/header.test.ts`:

```ts
import { headerOpacityForScrollX, HEADER_FADE_EPSILON } from '../../utils/header';

// Pager layout: [oldest day] … [today] [settings].
// settingsPage is the page index occupied by settings; width is page width.
const WIDTH = 375;
const SETTINGS_PAGE = 8; // e.g. maxDayIndex 7 → settings at page 8
const SETTINGS_X = SETTINGS_PAGE * WIDTH; // 3000
const FADE_START = SETTINGS_X - WIDTH; // 2625

describe('headerOpacityForScrollX', () => {
  it('returns 1 across day pages (offset before the final segment)', () => {
    expect(headerOpacityForScrollX(0, SETTINGS_PAGE, WIDTH)).toBe(1);
    expect(headerOpacityForScrollX(WIDTH, SETTINGS_PAGE, WIDTH)).toBe(1);
    expect(headerOpacityForScrollX(FADE_START, SETTINGS_PAGE, WIDTH)).toBe(1);
  });

  it('ramps 1 → 0 linearly across the final page-width before settings', () => {
    expect(headerOpacityForScrollX(FADE_START + WIDTH / 2, SETTINGS_PAGE, WIDTH)).toBeCloseTo(
      0.5,
      5,
    );
    expect(headerOpacityForScrollX(SETTINGS_X, SETTINGS_PAGE, WIDTH)).toBe(0);
  });

  it('clamps to [0, 1] beyond either end', () => {
    expect(headerOpacityForScrollX(-200, SETTINGS_PAGE, WIDTH)).toBe(1);
    expect(headerOpacityForScrollX(SETTINGS_X + WIDTH, SETTINGS_PAGE, WIDTH)).toBe(0);
  });

  it('returns 1 for a non-positive width (guard)', () => {
    expect(headerOpacityForScrollX(100, SETTINGS_PAGE, 0)).toBe(1);
  });

  it('crosses the pointerEvents epsilon just before the settings page', () => {
    // opacity 0.01 sits below the epsilon, so the bar becomes non-interactive
    const x = SETTINGS_X - 0.01 * WIDTH;
    expect(headerOpacityForScrollX(x, SETTINGS_PAGE, WIDTH)).toBeLessThan(HEADER_FADE_EPSILON);
    // opacity 0.5 stays above it
    expect(headerOpacityForScrollX(FADE_START + WIDTH / 2, SETTINGS_PAGE, WIDTH)).toBeGreaterThan(
      HEADER_FADE_EPSILON,
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/tests/utils/header.test.ts`
Expected: FAIL — `Cannot find module '../../utils/header'`.

- [ ] **Step 3: Write the minimal implementation**

Create `app/src/utils/header.ts`:

```ts
/** Below this opacity the pinned header bar stops intercepting touches. */
export const HEADER_FADE_EPSILON = 0.02;

/**
 * Opacity for the pinned header bar given the live horizontal scroll offset `x`.
 *
 * The pager is laid out `[oldest day] … [today] [settings]`. The bar is fully
 * opaque across every day page, then fades `1 → 0` across the final page-width
 * before the settings page so the settings segment is headerless.
 *
 * `settingsPage` is the page index occupied by settings; `width` is page width.
 * Marked as a worklet so it can run on the UI thread from `useAnimatedStyle`.
 */
export function headerOpacityForScrollX(x: number, settingsPage: number, width: number): number {
  'worklet';
  if (width <= 0) return 1;
  const settingsX = settingsPage * width;
  const fadeStart = settingsX - width;
  if (x <= fadeStart) return 1;
  if (x >= settingsX) return 0;
  const o = (settingsX - x) / width;
  return o < 0 ? 0 : o > 1 ? 1 : o;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/tests/utils/header.test.ts`
Expected: PASS (6 assertions across 5 cases).

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/header.ts app/src/tests/utils/header.test.ts
git commit -m "feat(app): headerOpacityForScrollX worklet helper for pinned header"
```

---

### Task 2: Extend the Reanimated Jest mock

The pinned bar uses `useAnimatedProps`, the pager uses `Animated.ScrollView` + `useAnimatedScrollHandler`, and (PR 2) the article uses `Easing`. The current mock lacks all four, so rendered tests that mount these components would crash. Add them now.

**Files:**

- Modify: `app/__mocks__/react-native-reanimated.ts`

- [ ] **Step 1: Replace the mock with the extended version**

Overwrite `app/__mocks__/react-native-reanimated.ts` with:

```ts
import { View, ScrollView } from 'react-native';

const Reanimated = {
  default: {
    View,
    ScrollView,
    createAnimatedComponent: (c: unknown) => c,
  },
  useSharedValue: (v: unknown) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useAnimatedProps: (fn: () => unknown) => fn(),
  useAnimatedScrollHandler: () => () => undefined,
  withTiming: (v: unknown) => v,
  withSpring: (v: unknown) => v,
  cancelAnimation: () => undefined,
  interpolate: (_v: unknown, _i: number[], output: number[]) => output[0],
  Extrapolation: { CLAMP: 'clamp' },
  Easing: {
    in: (e: unknown) => e,
    out: (e: unknown) => e,
    inOut: (e: unknown) => e,
    cubic: (t: number) => t,
  },
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
};

module.exports = Reanimated;
```

- [ ] **Step 2: Run the full suite to confirm nothing regressed**

Run: `cd app && npm test`
Expected: PASS — same green suite as before (the new mock keys are additive).

- [ ] **Step 3: Commit**

```bash
git add app/__mocks__/react-native-reanimated.ts
git commit -m "test(app): extend reanimated mock with ScrollView, scroll handler, animated props, Easing"
```

---

### Task 3: `PinnedHeaderBar` component

**Files:**

- Create: `app/src/components/PinnedHeaderBar.tsx`

- [ ] **Step 1: Write the component**

Create `app/src/components/PinnedHeaderBar.tsx`:

```tsx
import React from 'react';
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
  type SharedValue,
} from 'react-native-reanimated';
import PulseMark from './PulseMark';
import PulseIcon from './Icon';
import { font, type Theme, type Aesthetic } from '../themes';
import { headerOpacityForScrollX, HEADER_FADE_EPSILON } from '../utils/header';

interface Props {
  scrollX: SharedValue<number>;
  settingsPage: number;
  width: number;
  theme: Theme;
  aes: Aesthetic;
  canJump: boolean;
  onJump: () => void;
  onOpenSettings: () => void;
  onHeightChange: (h: number) => void;
}

const iconBtn = {
  width: 36,
  height: 36,
  borderRadius: 10,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

/**
 * The unchanging brand/controls line, rendered once and layered over the pager.
 * Stays visually pinned across day↔day swipes and fades out over the final
 * `today → settings` segment so the settings page is headerless. Reports its
 * measured height so the pager can pad day pages to clear it.
 */
export default function PinnedHeaderBar({
  scrollX,
  settingsPage,
  width,
  theme,
  aes,
  canJump,
  onJump,
  onOpenSettings,
  onHeightChange,
}: Props): React.ReactElement {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacityForScrollX(scrollX.value, settingsPage, width),
  }));

  const animatedProps = useAnimatedProps(() => {
    const o = headerOpacityForScrollX(scrollX.value, settingsPage, width);
    return { pointerEvents: (o < HEADER_FADE_EPSILON ? 'none' : 'auto') as 'none' | 'auto' };
  });

  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: theme.bg }, animatedStyle]}
      animatedProps={animatedProps}
      onLayout={(e: LayoutChangeEvent) => onHeightChange(e.nativeEvent.layout.height)}
    >
      <View style={styles.wordmark}>
        <PulseMark size={22} color={theme.text} accent={theme.accent} />
        <Text
          style={{
            fontFamily: font(aes, 'title', 700),
            fontSize: 22,
            lineHeight: 22,
            letterSpacing: -0.4,
            color: theme.text,
            marginLeft: 8,
          }}
        >
          Pulse
        </Text>
        <Text
          style={{
            fontFamily: font(aes, 'eyebrow', 600),
            fontSize: 9,
            lineHeight: 10,
            letterSpacing: 1.6,
            color: theme.accent,
            marginLeft: 8,
            textTransform: 'uppercase',
          }}
        >
          Daily
        </Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {canJump && (
          <Pressable
            onPress={onJump}
            style={iconBtn}
            hitSlop={6}
            accessibilityLabel="Jump to region"
          >
            <PulseIcon name="list-ul" size={18} color={theme.textDim} />
          </Pressable>
        )}
        <Pressable
          onPress={onOpenSettings}
          style={iconBtn}
          hitSlop={6}
          accessibilityLabel="Settings"
        >
          <PulseIcon name="settings" size={18} color={theme.textDim} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center' },
});
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: PASS (no errors). `DigestPager` is not wired to it yet, so this just validates the new file compiles.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/PinnedHeaderBar.tsx
git commit -m "feat(app): PinnedHeaderBar — fixed brand/controls line driven by scrollX"
```

---

### Task 4: Wire `DigestPager` to the pinned bar

Convert the outer pager to a Reanimated `Animated.ScrollView`, feed a `scrollX` shared value, render `PinnedHeaderBar` above it, strip `headerTop` from `DayHeader`, and pad day pages by the measured bar height. The existing `onMomentumScrollEnd` paging/commit logic is preserved unchanged.

**Files:**

- Modify: `app/src/components/DigestPager.tsx`

- [ ] **Step 1: Update the imports**

Replace lines 1-19 of `app/src/components/DigestPager.tsx` with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  useWindowDimensions,
  View,
  Text,
  StyleSheet,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { PressableScale } from 'react-native-pressable-scale';
import { DigestPage, type DigestPageHandle } from './DigestPage';
import PulseIcon from './Icon';
import PinnedHeaderBar from './PinnedHeaderBar';
import { THEMES, AESTHETICS, font, type Theme, type Aesthetic } from '../themes';
import { isoDateAtDayIndex, formatLongDate } from '../data';
import { useAppStore } from '../store';
import type { Headline, Region } from '../types';

/** Fallback day-page top padding before the bar reports its real height. */
const HEADER_HEIGHT_ESTIMATE = 56;
```

(Removes the now-unused `Pressable`, `ScrollView`, and `PulseMark` imports — `PulseMark` and the brand line moved to `PinnedHeaderBar`. `Pressable` is no longer used in this module; `PressableScale` covers the arrows.)

- [ ] **Step 2: Replace the `DayHeader` component (navRow only)**

Replace the whole `DayHeader` definition (originally lines 121-280, the `const DayHeader = React.memo(...)` block) with:

```tsx
/** Per-page header — now just the date/nav row. The brand line is pinned by PinnedHeaderBar. */
const DayHeader = React.memo(function DayHeader({
  dayIndex,
  maxDayIndex,
  theme,
  aes,
  onSetDay,
  topInset,
}: {
  dayIndex: number;
  maxDayIndex: number;
  theme: Theme;
  aes: Aesthetic;
  onSetDay: (n: number) => void;
  topInset: number;
}) {
  const isToday = dayIndex === 0;
  const fmt = formatLongDate(isoDateAtDayIndex(dayIndex));

  return (
    <View
      style={{
        backgroundColor: theme.bg,
        paddingHorizontal: 20,
        paddingTop: topInset,
        paddingBottom: 6,
      }}
    >
      <View style={styles.navRow}>
        {dayIndex < maxDayIndex ? (
          <PressableScale
            onPress={() => onSetDay(dayIndex + 1)}
            accessibilityLabel="Older day"
            activeScale={0.9}
            style={iconBtn}
          >
            <PulseIcon name="arrow-left" size={18} color={theme.textDim} />
          </PressableScale>
        ) : (
          <View style={iconBtn} />
        )}

        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text
            style={{
              fontFamily: font(aes, 'eyebrow', 600),
              fontSize: 9.5,
              lineHeight: 10,
              letterSpacing: 1.7,
              color: isToday ? theme.accent : theme.textFaint,
              marginBottom: 4,
              textTransform: 'uppercase',
            }}
          >
            {isToday ? 'Today' : `${dayIndex} ${dayIndex === 1 ? 'day' : 'days'} ago`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text
              style={{
                fontFamily: font(aes, 'title', 600),
                fontSize: 18,
                lineHeight: 18,
                letterSpacing: -0.2,
                color: theme.text,
              }}
            >
              {fmt.wd}, {fmt.mo} {fmt.day}
            </Text>
            {!isToday && (
              <PressableScale
                onPress={() => onSetDay(0)}
                accessibilityLabel="Jump to today"
                activeScale={0.92}
                style={{
                  marginLeft: 10,
                  backgroundColor: theme.accentSoft,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 999,
                }}
              >
                <Text
                  style={{
                    fontFamily: font(aes, 'ui', 600),
                    fontSize: 11,
                    color: theme.accent,
                    letterSpacing: -0.05,
                  }}
                >
                  Today
                </Text>
              </PressableScale>
            )}
          </View>
        </View>

        {dayIndex > 0 ? (
          <PressableScale
            onPress={() => onSetDay(dayIndex - 1)}
            accessibilityLabel="Newer day"
            activeScale={0.9}
            style={iconBtn}
          >
            <PulseIcon name="arrow-right" size={18} color={theme.textDim} />
          </PressableScale>
        ) : (
          <View style={iconBtn} />
        )}
      </View>
    </View>
  );
});
```

- [ ] **Step 3: Replace the default export body (pager)**

Replace the whole `export default React.memo(function DigestPager(...) { ... });` block (originally lines 282-400) with:

```tsx
export default React.memo(function DigestPager({
  dayIndex,
  setDayIndex,
  settingsSlot,
  onOpenArticle,
  activePageRef,
}: Props) {
  const { width: W } = useWindowDimensions();

  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const maxDayIndex = useAppStore((s) => maxDayIndexFor(s.prefs.historyDays));
  const showGlobalHeadlines = useAppStore((s) => s.prefs.showGlobalHeadlines);
  const selectedRegions = useAppStore((s) => s.prefs.selectedRegions);
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);

  const { getSlotSetter, setActivePage } = usePageRefs<DigestPageHandle>(activePageRef);
  useDigestRefreshOnNonce(activePageRef);

  const scrollRef = useRef<Animated.ScrollView>(null);
  // Page the strip is currently settled on. Initialised from the first-render
  // store state so the position-sync effect is a no-op on mount.
  const initialPage = useRef(
    screen === 'settings' ? settingsPage(maxDayIndex) : pageForDay(dayIndex, maxDayIndex),
  ).current;
  const currentPage = useRef(initialPage);
  const didLayout = useRef(false);

  // Live horizontal offset, fed by the animated scroll handler and read by the
  // pinned header bar to drive its fade. Seeded so the bar's opacity is correct
  // on first frame (0 when launching straight onto settings).
  const scrollX = useSharedValue(initialPage * W);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  // Measured pinned-bar height, used to pad day pages so their nav row clears it.
  const [headerHeight, setHeaderHeight] = useState(HEADER_HEIGHT_ESTIMATE);
  const onHeaderHeight = useCallback((h: number) => {
    setHeaderHeight((prev) => (Math.round(prev) === Math.round(h) ? prev : h));
  }, []);

  // Keep activePageRef pointed at the active day so notification refreshes hit the right page.
  useEffect(() => {
    setActivePage(dayIndex);
  }, [dayIndex, setActivePage]);

  // Drive the scroll position from store changes (header buttons, hardware back,
  // notification navigation). Guarded so it ignores echoes of the user's own scroll.
  useEffect(() => {
    const target =
      screen === 'settings' ? settingsPage(maxDayIndex) : pageForDay(dayIndex, maxDayIndex);
    if (currentPage.current === target) return;
    currentPage.current = target;
    scrollRef.current?.scrollTo({ x: target * W, animated: true });
  }, [screen, dayIndex, maxDayIndex, W]);

  // When the user settles on a page, reflect it back into the store. Setting
  // currentPage *before* the store write means the sync effect above no-ops.
  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / W);
      if (page === currentPage.current) return;
      currentPage.current = page;
      const target = targetForPage(page, maxDayIndex);
      if (target.kind === 'settings') {
        if (screen !== 'settings') setScreen('settings');
      } else {
        if (screen !== 'digest') setScreen('digest');
        if (target.dayIndex !== dayIndex) setDayIndex(target.dayIndex);
      }
    },
    [W, maxDayIndex, screen, dayIndex, setScreen, setDayIndex],
  );

  const onJump = useCallback(() => activePageRef.current?.openJumpModal(), [activePageRef]);
  const onOpenSettings = useCallback(() => setScreen('settings'), [setScreen]);

  const canJump = selectedRegions.length + (showGlobalHeadlines ? 1 : 0) > 1;
  const showSettings = dayIndex === 0 || screen === 'settings';

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumScrollEnd}
        contentOffset={{ x: initialPage * W, y: 0 }}
        // Android can ignore the initial contentOffset prop; re-apply once on first layout.
        onLayout={() => {
          if (didLayout.current) return;
          didLayout.current = true;
          scrollRef.current?.scrollTo({ x: currentPage.current * W, animated: false });
        }}
        style={{ flex: 1 }}
      >
        {Array.from({ length: maxDayIndex + 1 }, (_, p) => {
          const pageDayIndex = maxDayIndex - p;
          const inWindow = Math.abs(pageDayIndex - dayIndex) <= WINDOW;
          return (
            <View key={pageDayIndex} style={{ width: W }}>
              <DayHeader
                dayIndex={pageDayIndex}
                maxDayIndex={maxDayIndex}
                theme={theme}
                aes={aes}
                onSetDay={setDayIndex}
                topInset={headerHeight}
              />
              <View style={{ flex: 1 }}>
                {inWindow ? (
                  <DigestPage
                    ref={getSlotSetter(pageDayIndex)}
                    dayIndex={pageDayIndex}
                    active={pageDayIndex === dayIndex}
                    onOpenArticle={onOpenArticle}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
        {/* settings page — rightmost slot, mounted only when adjacent/open */}
        <View key="settings" style={{ width: W }}>
          {showSettings ? settingsSlot : null}
        </View>
      </Animated.ScrollView>

      <PinnedHeaderBar
        scrollX={scrollX}
        settingsPage={settingsPage(maxDayIndex)}
        width={W}
        theme={theme}
        aes={aes}
        canJump={canJump}
        onJump={onJump}
        onOpenSettings={onOpenSettings}
        onHeightChange={onHeaderHeight}
      />
    </View>
  );
});
```

- [ ] **Step 4: Update the `styles` block**

Replace the trailing `const styles = StyleSheet.create({...})` (originally lines 402-407) with:

```tsx
const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center' },
});
```

(The `header`, `headerTop`, and `wordmark` styles are gone — the brand line lives in `PinnedHeaderBar`; `navRow` no longer needs `marginTop` because the day page is padded by the bar height.)

- [ ] **Step 5: Typecheck and lint**

Run: `cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src/components/DigestPager.tsx src/components/PinnedHeaderBar.tsx`
Expected: PASS. If eslint flags an unused import, remove it (the import list in Step 1 is already pruned).

- [ ] **Step 6: Run the pager-related tests**

Run: `cd app && npm test -- DigestPager`
Expected: PASS — `DigestPager.pages.test.ts` (pure helpers, untouched) and `DigestPager.nonce.test.tsx` both green. The nonce test mounts the pager; the extended reanimated mock (Task 2) supplies `Animated.ScrollView`/`useAnimatedScrollHandler`.

- [ ] **Step 7: Run the full suite**

Run: `cd app && npm test`
Expected: PASS. In particular `App.openArticle.test.tsx` (mounts `RootScreens` → `DigestPager`) stays green.

- [ ] **Step 8: Commit**

```bash
git add app/src/components/DigestPager.tsx
git commit -m "refactor(app): pin header bar over pager, drive its fade from scrollX"
```

---

### Task 5 (optional): Component test — settings page is headerless

The spec marks this optional. Include it only if the rendered-component path is stable in CI. It asserts the pinned bar's pointerEvents go `none` when scrolled onto settings.

**Files:**

- Create: `app/src/tests/components/PinnedHeaderBar.test.tsx`

- [ ] **Step 1: Write the test**

Create `app/src/tests/components/PinnedHeaderBar.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import PinnedHeaderBar from '../../components/PinnedHeaderBar';
import { THEMES, AESTHETICS } from '../../themes';

const baseProps = {
  width: 375,
  settingsPage: 1,
  theme: THEMES.light,
  aes: AESTHETICS.editorial,
  canJump: true,
  onJump: jest.fn(),
  onOpenSettings: jest.fn(),
  onHeightChange: jest.fn(),
};

describe('PinnedHeaderBar', () => {
  it('renders the brand line and controls when on a day page (scrollX 0)', () => {
    const { getByText, getByLabelText } = render(
      <PinnedHeaderBar {...baseProps} scrollX={{ value: 0 } as never} />,
    );
    expect(getByText('Pulse')).toBeTruthy();
    expect(getByText('Daily')).toBeTruthy();
    expect(getByLabelText('Settings')).toBeTruthy();
    expect(getByLabelText('Jump to region')).toBeTruthy();
  });

  it('reports its measured height via onHeightChange on layout', () => {
    const onHeightChange = jest.fn();
    const { getByText } = render(
      <PinnedHeaderBar
        {...baseProps}
        onHeightChange={onHeightChange}
        scrollX={{ value: 0 } as never}
      />,
    );
    // Fire a layout event on the bar (its container wraps the "Pulse" text).
    const bar = getByText('Pulse').parent?.parent;
    bar?.props.onLayout?.({ nativeEvent: { layout: { height: 56 } } });
    expect(onHeightChange).toHaveBeenCalledWith(56);
  });
});
```

> Note: with the reanimated mock, `useAnimatedStyle`/`useAnimatedProps` evaluate their worklets eagerly against `scrollX.value`, so opacity/pointerEvents reflect the passed value. This test focuses on render + layout reporting; the opacity ramp itself is fully covered by `header.test.ts`.

- [ ] **Step 2: Run it**

Run: `cd app && npm test -- PinnedHeaderBar`
Expected: PASS. If the `getByText('Pulse').parent?.parent` traversal is brittle under the renderer version, delete this second case rather than fighting it — the helper unit test is the source of truth.

- [ ] **Step 3: Commit**

```bash
git add app/src/tests/components/PinnedHeaderBar.test.tsx
git commit -m "test(app): PinnedHeaderBar renders controls and reports height"
```

---

### PR 1 — open the pull request

- [ ] **Run the full gate from repo root and `app/`:**

```bash
npm run format:check
cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src && npm test
```

Expected: all green. (If `format:check` flags files, run `npm run format` from root, then re-check and amend.)

- [ ] **Manual device check (Android dev client):** swipe day↔day — the brand line stays visually fixed; swipe toward settings — the brand line fades to nothing and the settings page shows no header; day nav row sits correctly below the bar (no overlap, no double gap).

- [ ] **Open PR to `develop`** (confirm base branch is `develop`). Run `/code-review` first per repo discipline.

---

# PR 2 — Finger-tracking article close + edge mitigation

### Task 6: `resolveArticleSwipe` pure helper

**Files:**

- Create: `app/src/utils/swipe.ts`
- Test: `app/src/tests/utils/swipe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/src/tests/utils/swipe.test.ts`:

```ts
import { resolveArticleSwipe, SWIPE_DISTANCE, SWIPE_VELOCITY } from '../../utils/swipe';

describe('resolveArticleSwipe', () => {
  it('closes on a rightward drag past the distance threshold', () => {
    expect(resolveArticleSwipe(SWIPE_DISTANCE + 1, 0)).toBe('close');
  });

  it('closes on a fast rightward fling past the velocity threshold', () => {
    expect(resolveArticleSwipe(10, SWIPE_VELOCITY + 0.1)).toBe('close');
  });

  it('opens on a leftward drag past the distance threshold', () => {
    expect(resolveArticleSwipe(-(SWIPE_DISTANCE + 1), 0)).toBe('open');
  });

  it('opens on a fast leftward fling past the velocity threshold', () => {
    expect(resolveArticleSwipe(-10, -(SWIPE_VELOCITY + 0.1))).toBe('open');
  });

  it('stays for a neutral / sub-threshold gesture', () => {
    expect(resolveArticleSwipe(0, 0)).toBe('stay');
    expect(resolveArticleSwipe(SWIPE_DISTANCE, SWIPE_VELOCITY)).toBe('stay'); // boundary is exclusive
    expect(resolveArticleSwipe(-SWIPE_DISTANCE, -SWIPE_VELOCITY)).toBe('stay');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npm test -- src/tests/utils/swipe.test.ts`
Expected: FAIL — `Cannot find module '../../utils/swipe'`.

- [ ] **Step 3: Write the minimal implementation**

Create `app/src/utils/swipe.ts`:

```ts
/** Reused from the retired useSwipe hook so the close/open feel is unchanged. */
export const SWIPE_DISTANCE = 48;
export const SWIPE_VELOCITY = 0.45;

/**
 * Decide what a released article swipe should do.
 *   `close` — rightward past distance or velocity (dismiss the overlay)
 *   `open`  — leftward past distance or velocity (open the full article)
 *   `stay`  — otherwise (spring back)
 * `dx`/`vx` are the gesture's horizontal translation / velocity. Worklet so it
 * can be called directly from the gesture's `onEnd` on the UI thread.
 */
export function resolveArticleSwipe(dx: number, vx: number): 'open' | 'close' | 'stay' {
  'worklet';
  if (dx > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) return 'close';
  if (dx < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) return 'open';
  return 'stay';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npm test -- src/tests/utils/swipe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/swipe.ts app/src/tests/utils/swipe.test.ts
git commit -m "feat(app): resolveArticleSwipe worklet helper (close/open/stay)"
```

---

### Task 7: Expo local native module — `gesture-exclusion`

Adds `setEdgeExclusion(enabled)` backed by Android `View.setSystemGestureExclusionRects` (API 29+). No-op on iOS / below API 29. This is native Kotlin: it cannot be unit-tested in Jest (the JS binding is — Task 8) and is verified manually on-device.

**Files:**

- Create: `app/modules/gesture-exclusion/expo-module.config.json`
- Create: `app/modules/gesture-exclusion/android/src/main/java/com/pulse/news/gestureexclusion/GestureExclusionModule.kt`
- Create: `app/modules/gesture-exclusion/index.ts`

- [ ] **Step 1: Module config**

Create `app/modules/gesture-exclusion/expo-module.config.json`:

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["com.pulse.news.gestureexclusion.GestureExclusionModule"]
  }
}
```

- [ ] **Step 2: Kotlin module**

Create `app/modules/gesture-exclusion/android/src/main/java/com/pulse/news/gestureexclusion/GestureExclusionModule.kt`:

```kotlin
package com.pulse.news.gestureexclusion

import android.graphics.Rect
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GestureExclusionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GestureExclusion")

    // Apply (or clear) system-gesture-exclusion rects on the left & right edges
    // so an edge swipe is less likely to trigger the OS back gesture. The OS
    // caps the excludable height at ~200dp per edge (API 29+); we clamp to that.
    Function("setEdgeExclusion") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@Function
      activity.runOnUiThread {
        val root = activity.window?.decorView?.rootView ?: return@runOnUiThread
        if (!enabled) {
          root.systemGestureExclusionRects = emptyList()
          return@runOnUiThread
        }
        val height = root.height
        val width = root.width
        if (height <= 0 || width <= 0) return@runOnUiThread
        val density = root.resources.displayMetrics.density
        val capPx = (200 * density).toInt() // OS cap per edge
        val band = minOf(height, capPx)
        val edgePx = (24 * density).toInt() // width of the excluded strip
        val top = (height - band) / 2
        root.systemGestureExclusionRects = listOf(
          Rect(0, top, edgePx, top + band),
          Rect(width - edgePx, top, width, top + band),
        )
      }
    }
  }
}
```

- [ ] **Step 3: JS binding**

Create `app/modules/gesture-exclusion/index.ts`:

```ts
import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

interface GestureExclusionNativeModule {
  setEdgeExclusion(enabled: boolean): void;
}

/**
 * Toggle left/right edge gesture-exclusion rects on the current Android
 * activity. No-op on iOS and (handled natively) below API 29. The native
 * module is resolved lazily and any resolution failure degrades to a no-op.
 */
export function setEdgeExclusion(enabled: boolean): void {
  if (Platform.OS !== 'android') return;
  let nativeModule: GestureExclusionNativeModule;
  try {
    nativeModule = requireNativeModule('GestureExclusion') as GestureExclusionNativeModule;
  } catch {
    return;
  }
  nativeModule.setEdgeExclusion(enabled);
}
```

- [ ] **Step 4: Typecheck (binding compiles; native is built separately)**

Run: `cd app && npx tsc --noEmit`
Expected: FAIL with `Cannot find module 'expo-modules-core'` _only if_ types aren't resolvable — they are (it's a transitive Expo dep). If it fails on `requireNativeModule`'s generic, the cast in Step 3 already avoids generics. Otherwise PASS. (Jest resolution is wired in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add app/modules/gesture-exclusion
git commit -m "feat(app): gesture-exclusion native module (Android edge exclusion shim)"
```

---

### Task 8: JS binding mock + unit test

**Files:**

- Create: `app/__mocks__/expo-modules-core.ts`
- Modify: `app/jest.config.cjs`
- Create: `app/src/tests/modules/gesture-exclusion.test.ts`

- [ ] **Step 1: Manual mock for `expo-modules-core`**

Create `app/__mocks__/expo-modules-core.ts`:

```ts
// Minimal mock — the gesture-exclusion binding is the only importer in JS.
export const nativeGestureExclusion = { setEdgeExclusion: jest.fn() };
export const requireNativeModule = jest.fn(() => nativeGestureExclusion);
```

- [ ] **Step 2: Map it in the Jest config**

In `app/jest.config.cjs`, add this line inside `moduleNameMapper` (next to the other mappings):

```js
    '^expo-modules-core$': '<rootDir>/__mocks__/expo-modules-core.ts',
```

- [ ] **Step 3: Write the binding test**

Create `app/src/tests/modules/gesture-exclusion.test.ts`:

```ts
import { Platform } from 'react-native';
import { requireNativeModule, nativeGestureExclusion } from 'expo-modules-core';
import { setEdgeExclusion } from '../../../modules/gesture-exclusion';

const platform = Platform as unknown as { OS: string };

describe('setEdgeExclusion binding', () => {
  const originalOS = platform.OS;
  afterEach(() => {
    jest.clearAllMocks();
    platform.OS = originalOS;
  });

  it('forwards enable/disable to the native module on Android', () => {
    platform.OS = 'android';
    setEdgeExclusion(true);
    expect(requireNativeModule).toHaveBeenCalledWith('GestureExclusion');
    expect(nativeGestureExclusion.setEdgeExclusion).toHaveBeenCalledWith(true);

    setEdgeExclusion(false);
    expect(nativeGestureExclusion.setEdgeExclusion).toHaveBeenLastCalledWith(false);
  });

  it('is a no-op on non-Android platforms', () => {
    platform.OS = 'ios';
    setEdgeExclusion(true);
    expect(requireNativeModule).not.toHaveBeenCalled();
    expect(nativeGestureExclusion.setEdgeExclusion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run it**

Run: `cd app && npm test -- gesture-exclusion`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add app/__mocks__/expo-modules-core.ts app/jest.config.cjs app/src/tests/modules/gesture-exclusion.test.ts
git commit -m "test(app): unit-test setEdgeExclusion JS binding (android forward, iOS no-op)"
```

---

### Task 9: Rewrite `ArticleScreen` with finger-tracking close

Replace `useSlideIn` + `useSwipe` with a gesture-handler `Pan` driving a Reanimated `translateX`. Drag-right tracks the finger 1:1 (revealing the digest beneath, already mounted in `RootScreens`); release decides via `resolveArticleSwipe`. Entry slides in. Mount/unmount toggles `setEdgeExclusion`.

**Files:**

- Modify: `app/src/screens/ArticleScreen.tsx`

- [ ] **Step 1: Replace the imports and component logic (top of file)**

Replace lines 1-60 of `app/src/screens/ArticleScreen.tsx` (everything from the imports through the `copyLink` definition, i.e. up to and including the closing of `const copyLink = ...`) with:

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { font, THEMES, AESTHETICS } from '../themes';
import { useAppStore } from '../store';
import PulseIcon from '../components/Icon';
import Flag from '../components/Flag';
import { openExternalUrl } from '../utils/openExternalUrl';
import { resolveArticleSwipe } from '../utils/swipe';
import { setEdgeExclusion } from '../../modules/gesture-exclusion';
import type { Headline, Region } from '../types';

interface Props {
  headline: Headline;
  region: Region;
  onClose: () => void;
}

export default function ArticleScreen({
  headline,
  region,
  onClose,
}: Props): React.ReactElement | null {
  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guards onClose so it fires exactly once across the back button + gesture paths.
  const closedRef = useRef(false);
  // Off-screen to the right; slides to 0 on mount, follows the finger on drag.
  const translateX = useSharedValue(W);

  useEffect(() => {
    translateX.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    setEdgeExclusion(true);
    return () => {
      setEdgeExclusion(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose();
  }, [onClose]);

  const animateClose = useCallback(() => {
    translateX.value = withTiming(W, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(handleClose)();
    });
  }, [W, handleClose, translateX]);

  const openArticle = useCallback((): void => {
    openExternalUrl(headline.url);
  }, [headline.url]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-15, 15])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          // Track the finger 1:1 in the close direction; clamp the open direction at 0.
          translateX.value = Math.max(0, e.translationX);
        })
        .onEnd((e) => {
          const action = resolveArticleSwipe(e.translationX, e.velocityX);
          if (action === 'close') {
            translateX.value = withTiming(W, { duration: 200, easing: Easing.in(Easing.cubic) }, (finished) => {
              if (finished) runOnJS(handleClose)();
            });
          } else if (action === 'open') {
            translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
            runOnJS(openArticle)();
          } else {
            translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
          }
        }),
    [W, handleClose, openArticle, translateX],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const hostname = useMemo<string>(() => {
    try {
      return new URL(headline.url).hostname.replace(/^www\./, '');
    } catch {
      return headline.url;
    }
  }, [headline.url]);

  const copyLink = (): void => {
    void Clipboard.setStringAsync(headline.url).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  };
```

- [ ] **Step 2: Replace the JSX wrapper (return statement)**

Replace the outer `<Animated.View ... {...panHandlers}> ... </Animated.View>` wrapper. Specifically:

(a) Replace the opening of the return (originally lines 62-69):

```tsx
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: theme.bg, zIndex: 100, transform: [{ translateX: slideAnim }] },
      ]}
      {...panHandlers}
    >
```

with:

```tsx
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, zIndex: 100 }, animatedStyle]}
      >
```

(b) Change the back-button `onPress` (originally line 78) from `onPress={dismiss}` to:

```tsx
onPress = { animateClose };
```

(c) Change the inner scroll container from `Animated.ScrollView` (RN core Animated) to a plain `ScrollView`. Replace the opening tag (originally lines 106-110):

```tsx
      <Animated.ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
```

with:

```tsx
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
```

(d) Replace the closing tags (originally lines 268-269):

```tsx
      </Animated.ScrollView>
    </Animated.View>
  );
```

with:

```tsx
        </ScrollView>
      </Animated.View>
    </GestureDetector>
  );
```

> The "Read full article" button (`onPress={openArticle}`) and the swipe hint texts are unchanged. The `s` StyleSheet block at the bottom is unchanged.

- [ ] **Step 3: Typecheck and lint**

Run: `cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src/screens/ArticleScreen.tsx`
Expected: PASS. (`slideAnim`, `dismiss`, `panHandlers`, and the RN `Animated` import are all gone; no unused symbols.)

- [ ] **Step 4: Run the article tests**

Run: `cd app && npm test -- ArticleScreen`
Expected: PASS. The existing `ArticleScreen.test.tsx` (hostname, copy, category chip, detail, read-full-article) still passes: the gesture-handler mock renders `GestureDetector` children through, the reanimated mock supplies `Easing`/`withTiming`/etc., and the `expo-modules-core` mock makes `setEdgeExclusion` a safe no-op under Jest.

- [ ] **Step 5: Run the full suite**

Run: `cd app && npm test`
Expected: PASS — including `App.openArticle.test.tsx` (mounts `ArticleScreen`).

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/ArticleScreen.tsx
git commit -m "feat(app): finger-tracking article close via Pan + Reanimated translateX"
```

---

### Task 10: Clean up `SettingsScreen` (remove the retired hooks)

`SettingsScreen` calls `useSlideIn`/`useSwipe` only in its non-embedded branch, which is dead in the live app (always rendered `embedded`). Remove the hook usage so the hooks can be deleted (Task 11). In-app behaviour is unchanged.

**Files:**

- Modify: `app/src/screens/SettingsScreen.tsx`

- [ ] **Step 1: Remove the hook imports**

Delete these two lines (originally lines 22-23):

```tsx
import { useSlideIn } from '../hooks/useSlideIn';
import { useSwipe } from '../hooks/useSwipe';
```

- [ ] **Step 2: Remove `Animated` from the react-native import**

In the `react-native` import block (lines 2-14), delete the `Animated,` line — the root view is no longer animated.

- [ ] **Step 3: Replace the hook calls + handleBack**

Replace these three lines (originally lines 48-50):

```tsx
const { slideAnim, dismiss } = useSlideIn(() => setScreen('digest'));
const panHandlers = useSwipe(undefined, dismiss);
const handleBack = embedded ? () => setScreen('digest') : dismiss;
```

with:

```tsx
const handleBack = (): void => setScreen('digest');
```

- [ ] **Step 4: Replace the animated root view**

Replace the root element (originally lines 77-95, the `<Animated.View ...>` opening through the start of the header `<View ...>`). Specifically replace:

```tsx
    <Animated.View
      style={
        embedded
          ? // embedded inside the pager, which already lives inside App's SafeAreaView —
            // don't re-apply insets, and no slide transform (the pager owns the motion)
            { flex: 1, backgroundColor: theme.bg }
          : [
              StyleSheet.absoluteFill,
              {
                backgroundColor: theme.bg,
                zIndex: 50,
                transform: [{ translateX: slideAnim }],
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              },
            ]
      }
      {...(embedded ? {} : panHandlers)}
    >
```

with:

```tsx
    <View
      style={
        embedded
          ? // embedded inside the pager, which already lives inside App's SafeAreaView
            { flex: 1, backgroundColor: theme.bg }
          : [
              StyleSheet.absoluteFill,
              {
                backgroundColor: theme.bg,
                zIndex: 50,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              },
            ]
      }
    >
```

- [ ] **Step 5: Close the root with `</View>`**

Find the matching closing `</Animated.View>` for the root element (the last one in the component's `return`) and change it to `</View>`.

- [ ] **Step 6: Typecheck and lint**

Run: `cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src/screens/SettingsScreen.tsx`
Expected: PASS. If lint reports `insets` unused, it isn't — the non-embedded branch still reads `insets.top`/`insets.bottom`.

- [ ] **Step 7: Run the settings tests**

Run: `cd app && npm test -- SettingsScreen`
Expected: PASS — `SettingsScreen.test.tsx` renders the component (default `embedded=false`) and asserts content/toggles, none of which depended on the removed animation.

- [ ] **Step 8: Commit**

```bash
git add app/src/screens/SettingsScreen.tsx
git commit -m "refactor(app): drop dead slide/swipe animation from SettingsScreen"
```

---

### Task 11: Delete the retired hooks

**Files:**

- Delete: `app/src/hooks/useSlideIn.ts`
- Delete: `app/src/hooks/useSwipe.ts`

- [ ] **Step 1: Confirm no importers remain**

Run: `cd app && npx eslint --ext .ts,.tsx src` and additionally grep:
`grep -rn "useSlideIn\|useSwipe" src` (expected: zero matches now that ArticleScreen and SettingsScreen are migrated).

- [ ] **Step 2: Delete the files**

```bash
git rm app/src/hooks/useSlideIn.ts app/src/hooks/useSwipe.ts
```

- [ ] **Step 3: Typecheck + full suite**

Run: `cd app && npx tsc --noEmit && npm test`
Expected: PASS, no unresolved imports. (There are no dedicated tests for these hooks to remove.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(app): delete retired useSlideIn/useSwipe hooks"
```

---

### PR 2 — verify, security-review, open the pull request

- [ ] **Run the full gate:**

```bash
npm run format:check
cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src && npm test
```

Expected: all green. (Run `npm run format` from root first if needed.)

- [ ] **Build the dev client with the new native module and verify on-device:**

```bash
cd app && npx expo run:android
```

Manual checks:

- Open an article → it slides in.
- Drag right slowly → the overlay tracks the finger 1:1 and the digest is revealed live beneath; release past threshold → snaps closed; release before threshold → springs back.
- Drag left past threshold → the full article opens (current `openExternalUrl` destination); overlay stays put visually.
- Vertical scroll inside the article body is unaffected (gesture only claims horizontal).
- Back button and hardware back both close the overlay once (no double-dismiss).
- With the article open, swipe from the very screen edges: the OS back gesture fires noticeably less often within the excluded band (reduced, not eliminated — OS-capped).

- [ ] **Reviews:** Run `/code-review`. Per repo discipline this PR touches gesture/native/deep-link-adjacent behaviour, so also run `/security-review`.

- [ ] **Open PR to `develop`** (confirm base is `develop`).

---

## Self-review (performed against the spec)

**Spec coverage**

- Header pinned across day↔day, fades to nothing over settings → Tasks 1, 3, 4 (helper + bar + pager wiring).
- Continuous scroll tracking via `Animated.ScrollView` + `useAnimatedScrollHandler`, `onMomentumScrollEnd` preserved → Task 4 (both handlers coexist).
- `headerOpacityForScrollX` pure worklet, clamps `[0,1]`, pointerEvents epsilon → Task 1 (+ component uses `HEADER_FADE_EPSILON`).
- Safe-area top inset owned by the bar → bar sits at top of App's `SafeAreaView`; day pages padded by measured bar height (Task 4, `topInset`).
- Finger-tracking close, reveal beneath, threshold snap → Task 9 (`Pan` + `translateX`, digest already mounted in `RootScreens`).
- `resolveArticleSwipe` worklet reusing `DISTANCE=48`/`VELOCITY=0.45` → Task 6.
- Entry slide-in retained → Task 9 (`withTiming` `W → 0` on mount).
- `activeOffsetX`/`failOffsetY` so vertical scroll isn't captured → Task 9.
- Unmount mid-animation guard (single `onClose`) → Task 9 (`closedRef`).
- Retire `useSlideIn`/`useSwipe` → Tasks 10 (SettingsScreen cleanup, **spec correction**) + 11 (delete).
- Native `gesture-exclusion` module, `setEdgeExclusion(enabled)`, left/right edges, ~200dp cap, API 29+/iOS no-op, mount/unmount calls → Tasks 7 (Kotlin + binding) + 9 (call sites).
- JS-binding unit test (android forward, iOS no-op) → Task 8.
- Optional settings-headerless component test → Task 5.

**Placeholder scan:** none — every code step contains complete content.

**Type consistency:** `headerOpacityForScrollX(x, settingsPage, width)` and `HEADER_FADE_EPSILON` identical across helper, bar, and tests. `resolveArticleSwipe(dx, vx) → 'open'|'close'|'stay'` and `SWIPE_DISTANCE`/`SWIPE_VELOCITY` identical across helper, ArticleScreen, and tests. `setEdgeExclusion(enabled: boolean)` identical across Kotlin `Name`, binding, call sites, and test.

## Risks & tradeoffs (from the spec, confirmed)

- **Reanimated v4 + RNGH worklet correctness** — first worklets in the codebase (no prior `resolveSwipe`); all decision logic is pure worklet helpers with `runOnJS` for side effects. Validated on-device.
- **Pager conversion to `Animated.ScrollView`** — paging + `onMomentumScrollEnd` commit logic preserved verbatim; the animated handler only _reads_ `x`. Main manual-test focus for PR 1.
- **Edge exclusion is partial by OS design** — ~200dp/edge cap; documented and accepted.
- **`Animated.ScrollView` imperative `scrollTo`** — relies on Reanimated forwarding `scrollTo` through the animated ref (standard usage). If a future Reanimated version regresses this, switch to `useAnimatedRef` + the `scrollTo` worklet.

## Non-goals (unchanged)

- No React Navigation. No change to digest data model / day indexing / settings content. No attempt to fully disable the Android system back gesture. The in-app WebView reader is a separate spec.
