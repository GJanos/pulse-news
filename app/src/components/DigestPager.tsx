import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWindowDimensions, View, Text, Pressable, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { PressableScale } from 'react-native-pressable-scale';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  cancelAnimation,
  runOnJS,
} from 'react-native-reanimated';
import { DigestPage, type DigestPageHandle } from './DigestPage';
import PulseMark from './PulseMark';
import PulseIcon from './Icon';
import { THEMES, AESTHETICS, font } from '../themes';
import { isoDateAtDayIndex, formatLongDate } from '../data';
import { useAppStore } from '../store';
import type { Headline, Region } from '../types';

interface Props {
  dayIndex: number;
  setDayIndex: (n: number) => void;
  onOpenSettings: () => void;
  onOpenArticle: (h: Headline, r: Region) => void;
  activePageRef: React.RefObject<DigestPageHandle | null>;
}

const SPRING = { damping: 28, stiffness: 220, mass: 0.9 } as const;
const WINDOW = 1;

/**
 * `historyDays: N` means N days back from today, so the oldest reachable page is
 * day-index N (today is 0). Clamped to >= 0. Total page slots are this + 1
 * (today + N prior days), i.e. N ⇒ N+1 pages.
 */
export function maxDayIndexFor(historyDays: number): number {
  return Math.max(0, historyDays);
}

export type SwipeOutcome = 'older' | 'newer' | 'open-settings' | 'none';

/** Pure helper — determines the outcome of a completed pan gesture. Extracted for unit testability. */
export function resolveSwipe({
  dayIndex,
  dx,
  vx,
  maxDayIndex,
  threshold,
  velocityTrigger,
}: {
  dayIndex: number;
  dx: number;
  vx: number;
  maxDayIndex: number;
  threshold: number;
  velocityTrigger: number;
}): SwipeOutcome {
  if (dx > threshold || vx > velocityTrigger) {
    return dayIndex < maxDayIndex ? 'older' : 'none';
  }
  if (dx < -threshold || vx < -velocityTrigger) {
    return dayIndex === 0 ? 'open-settings' : 'newer';
  }
  return 'none';
}

function txFor(dayIndex: number, maxDayIndex: number, W: number): number {
  'worklet';
  return -(maxDayIndex - dayIndex) * W;
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

export default React.memo(function DigestPager({
  dayIndex,
  setDayIndex,
  onOpenSettings,
  onOpenArticle,
  activePageRef,
}: Props) {
  const { width: W } = useWindowDimensions();

  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const maxDayIndex = useAppStore((s) => maxDayIndexFor(s.prefs.historyDays));
  const showGlobalHeadlines = useAppStore((s) => s.prefs.showGlobalHeadlines);
  const selectedRegions = useAppStore((s) => s.prefs.selectedRegions);

  const isToday = dayIndex === 0;
  const date = useMemo(() => isoDateAtDayIndex(dayIndex), [dayIndex]);
  const fmt = useMemo(() => formatLongDate(date), [date]);

  const tx = useSharedValue(txFor(dayIndex, maxDayIndex, W));
  const startTx = useSharedValue(txFor(dayIndex, maxDayIndex, W));
  const { getSlotSetter, setActivePage } = usePageRefs<DigestPageHandle>(activePageRef);
  useDigestRefreshOnNonce(activePageRef);

  const skipNextSpring = useRef(false);
  const commitDay = useCallback(
    (idx: number) => {
      skipNextSpring.current = true;
      setDayIndex(idx);
    },
    [setDayIndex],
  );

  useEffect(() => {
    setActivePage(dayIndex);
    if (skipNextSpring.current) {
      skipNextSpring.current = false;
      return;
    }
    cancelAnimation(tx);
    tx.value = withSpring(txFor(dayIndex, maxDayIndex, W), SPRING);
  }, [dayIndex, maxDayIndex, W, setActivePage]); // tx is a Reanimated shared value and excluded from deps

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-15, 15])
    .onStart(() => {
      cancelAnimation(tx);
      startTx.value = tx.value;
    })
    .onUpdate((e) => {
      let next = startTx.value + e.translationX;
      const leftBound = txFor(0, maxDayIndex, W);
      const rightBound = 0;
      if (next > rightBound) next = rightBound + (next - rightBound) * 0.35;
      if (next < leftBound) next = leftBound + (next - leftBound) * 0.35;
      tx.value = next;
    })
    .onEnd((e) => {
      const vx = e.velocityX;
      const dx = e.translationX;
      const outcome = resolveSwipe({
        dayIndex,
        dx,
        vx,
        maxDayIndex,
        threshold: W * 0.22,
        velocityTrigger: 600,
      });
      if (outcome === 'open-settings') {
        tx.value = withSpring(txFor(dayIndex, maxDayIndex, W), { ...SPRING, velocity: vx });
        runOnJS(onOpenSettings)();
      } else {
        const target =
          outcome === 'older' ? dayIndex + 1 : outcome === 'newer' ? dayIndex - 1 : dayIndex;
        tx.value = withSpring(txFor(target, maxDayIndex, W), { ...SPRING, velocity: vx });
        if (target !== dayIndex) runOnJS(commitDay)(target);
      }
    });

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const totalSlots = maxDayIndex + 1;
  const canJump = selectedRegions.length + (showGlobalHeadlines ? 1 : 0) > 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={[styles.header, { backgroundColor: theme.bg }]}>
        <View style={styles.headerTop}>
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
                onPress={() => activePageRef.current?.openJumpModal()}
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
        </View>

        <View style={styles.navRow}>
          {dayIndex < maxDayIndex ? (
            <PressableScale
              onPress={() => setDayIndex(dayIndex + 1)}
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
                  onPress={() => setDayIndex(0)}
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
              onPress={() => setDayIndex(dayIndex - 1)}
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

      <GestureDetector gesture={pan}>
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <Animated.View style={[styles.strip, { width: W * totalSlots }, stripStyle]}>
            {Array.from({ length: totalSlots }, (_, i) => {
              const pageDayIndex = maxDayIndex - i;
              const inWindow = Math.abs(pageDayIndex - dayIndex) <= WINDOW;
              return (
                <View key={pageDayIndex} style={{ width: W }}>
                  {inWindow ? (
                    <DigestPage
                      ref={getSlotSetter(pageDayIndex)}
                      dayIndex={pageDayIndex}
                      active={pageDayIndex === dayIndex}
                      onOpenArticle={onOpenArticle}
                    />
                  ) : null}
                </View>
              );
            })}
          </Animated.View>
        </View>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { flexDirection: 'row', alignItems: 'center' },
  navRow: { marginTop: 10, flexDirection: 'row', alignItems: 'center' },
  strip: { flex: 1, flexDirection: 'row' },
});
