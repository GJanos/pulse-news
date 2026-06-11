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
import { ErrorBoundary } from './ErrorBoundary';
import { THEMES, AESTHETICS, font, type Theme, type Aesthetic } from '../themes';
import { isoDateAtDayIndex, formatLongDate } from '../data';
import { useTodayISO } from '../hooks/useTodayISO';
import { useAppStore } from '../store';
import type { Headline, Region } from '../types';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';

const AnimatedPager = Animated.createAnimatedComponent(GHScrollView);

/** Fallback day-page top padding before the bar reports its real height. */
const HEADER_HEIGHT_ESTIMATE = 56;

interface Props {
  dayIndex: number;
  setDayIndex: (n: number) => void;
  settingsSlot: React.ReactNode;
  onOpenArticle: (h: Headline, r: Region) => void;
  activePageRef: React.RefObject<DigestPageHandle | null>;
}

const WINDOW = 1;

/**
 * `historyDays: N` means N days back from today, so the oldest reachable page is
 * day-index N (today is 0). Clamped to >= 0. Total day pages are this + 1
 * (today + N prior days), i.e. N ⇒ N+1 day pages.
 */
export function maxDayIndexFor(historyDays: number): number {
  return Math.max(0, historyDays);
}

/**
 * The pager is a single horizontal paging ScrollView laid out left→right as
 * `[oldest day] … [today] [settings]`. These pure helpers map between a
 * day-index / the settings screen and the scroll page index they occupy.
 */
export function pageForDay(dayIndex: number, maxDayIndex: number): number {
  return maxDayIndex - dayIndex;
}

export function settingsPage(maxDayIndex: number): number {
  return maxDayIndex + 1;
}

export type PagerTarget = { kind: 'settings' } | { kind: 'day'; dayIndex: number };

/** Resolve which logical destination a settled scroll page corresponds to. */
export function targetForPage(page: number, maxDayIndex: number): PagerTarget {
  if (page >= settingsPage(maxDayIndex)) return { kind: 'settings' };
  const dayIndex = Math.max(0, Math.min(maxDayIndex, maxDayIndex - page));
  return { kind: 'day', dayIndex };
}

function usePageRefs<T>(activeRef: React.RefObject<T | null>) {
  const pageRefs = useRef<Map<number, T | null>>(new Map());
  const setters = useRef(new Map<number, (h: T | null) => void>());
  const activeKey = useRef<number | null>(null);

  const getSlotSetter = useCallback(
    (pageDayIndex: number) => {
      let setter = setters.current.get(pageDayIndex);
      if (!setter) {
        setter = (h: T | null) => {
          pageRefs.current.set(pageDayIndex, h);
          if (pageDayIndex === activeKey.current)
            (activeRef as React.MutableRefObject<T | null>).current = h;
        };
        setters.current.set(pageDayIndex, setter);
      }
      return setter;
    },
    [activeRef],
  );

  const setActivePage = useCallback(
    (idx: number) => {
      activeKey.current = idx;
      (activeRef as React.MutableRefObject<T | null>).current = pageRefs.current.get(idx) ?? null;
    },
    [activeRef],
  );

  return { getSlotSetter, setActivePage };
}

const iconBtn = {
  width: 36,
  height: 36,
  borderRadius: 10,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

/**
 * Force-refreshes the active digest page whenever the nav slice bumps
 * `digestRefreshNonce` (e.g. a daily_digest notification tap). Skips the
 * initial mount so the normal first render isn't double-fetched.
 */
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

/** Per-page header — now just the date/nav row. The brand line is pinned by PinnedHeaderBar. */
const DayHeader = React.memo(function DayHeader({
  dayIndex,
  maxDayIndex,
  todayISO,
  theme,
  aes,
  onSetDay,
  topInset,
}: {
  dayIndex: number;
  maxDayIndex: number;
  /** Fresh today date — busts the memo when the app foregrounds past midnight. */
  todayISO: string;
  theme: Theme;
  aes: Aesthetic;
  onSetDay: (n: number) => void;
  topInset: number;
}) {
  const isToday = dayIndex === 0;
  const fmt = formatLongDate(isoDateAtDayIndex(dayIndex, todayISO));

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
          <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 28 }}>
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
                  minHeight: 28,
                  justifyContent: 'center',
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
  const showCurrencyRates = useAppStore((s) => s.prefs.showCurrencyRates);
  const selectedRegions = useAppStore((s) => s.prefs.selectedRegions);
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);

  const { getSlotSetter, setActivePage } = usePageRefs<DigestPageHandle>(activePageRef);
  useDigestRefreshOnNonce(activePageRef);
  const todayISO = useTodayISO();

  const scrollRef = useRef<GHScrollView>(null);
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AnimatedPager
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
                todayISO={todayISO}
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
                    currencyRatesEnabled={
                      showCurrencyRates && pageDayIndex === 0 && screen !== 'settings'
                    }
                    onOpenArticle={onOpenArticle}
                  />
                ) : null}
              </View>
            </View>
          );
        })}
        {/* settings page — rightmost slot, kept mounted to avoid expensive re-initialization on swipe */}
        <View key="settings" style={{ width: W }}>
          <ErrorBoundary>{settingsSlot}</ErrorBoundary>
        </View>
      </AnimatedPager>

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

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center' },
});
