import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { THEMES, AESTHETICS, font } from '../themes';
import { useDigestPageData } from '../hooks/useDigestPageData';
import { useTodayISO } from '../hooks/useTodayISO';
import { useJumpTargets, type ListItem } from '../hooks/useJumpTargets';
import JumpModal from './JumpModal';
import { isoDateAtDayIndex } from '../data';
import { RegionSection } from './RegionSection';
import { GlobalSection } from './GlobalSection';
import { useAppStore } from '../store';
import type { Headline, Region } from '../types';

export interface DigestPageHandle {
  forceRefresh: () => void;
  openJumpModal: () => void;
}

interface Props {
  dayIndex: number;
  onOpenArticle: (h: Headline, r: Region) => void;
  currencyRatesEnabled: boolean;
}

export const DigestPage = React.memo(
  React.forwardRef<DigestPageHandle, Props>(function DigestPage(
    { dayIndex, onOpenArticle, currencyRatesEnabled },
    ref,
  ) {
    const isToday = dayIndex === 0;
    // todayISO is a dep on purpose: when the app foregrounds past midnight the
    // mounted page must move to the new date, or a notification tap refreshes
    // yesterday's digest until the app is killed and relaunched.
    const todayISO = useTodayISO();
    const date = useMemo(() => isoDateAtDayIndex(dayIndex, todayISO), [dayIndex, todayISO]);

    const theme = useAppStore((s) => THEMES[s.prefs.theme]);
    const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
    const notifyTime = useAppStore((s) => s.prefs.notifyTime);

    const {
      digest,
      error,
      isLoading,
      visible,
      visibleGlobalHeadlines,
      hasGlobal,
      totalHeadlines,
      currencyRates,
      forceRefresh,
    } = useDigestPageData(date, isToday, currencyRatesEnabled);

    const flatRef = useRef<FlatList<ListItem> | null>(null);
    const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
      () => () => {
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      },
      [],
    );
    const { listData, indexMapRef } = useJumpTargets(visible, visibleGlobalHeadlines, hasGlobal);

    const [refreshing, setRefreshing] = useState(false);
    const onRefresh = useCallback(() => {
      setRefreshing(true);
      void forceRefresh().finally(() => setRefreshing(false));
    }, [forceRefresh]);

    const [jumpOpen, setJumpOpen] = useState(false);
    const openJumpModal = useCallback(() => setJumpOpen(true), []);

    const onScrollToIndexFailed = useCallback(
      (info: { index: number; highestMeasuredFrameIndex: number; averageItemLength: number }) => {
        flatRef.current?.scrollToOffset({
          offset: info.averageItemLength * info.index,
          animated: false,
        });
        scrollTimerRef.current = setTimeout(() => {
          flatRef.current?.scrollToIndex({ index: info.index, animated: true });
        }, 100);
      },
      [],
    );

    const scrollToIndexSafe = useCallback((index: number) => {
      if (index < 0) return;
      flatRef.current?.scrollToIndex({ index, animated: true });
    }, []);

    const jumpTo = useCallback(
      (name: string) => {
        setJumpOpen(false);
        const idx = indexMapRef.current.get(name);
        if (idx !== undefined) scrollToIndexSafe(idx);
      },
      [scrollToIndexSafe, indexMapRef],
    );

    React.useImperativeHandle(ref, () => ({ forceRefresh, openJumpModal }), [
      forceRefresh,
      openJumpModal,
    ]);

    const renderItem = useCallback(
      ({ item }: { item: ListItem }) => {
        if (item.type === 'global') {
          return <GlobalSection headlines={item.payload} onOpenArticle={onOpenArticle} />;
        }
        return (
          <RegionSection
            bucket={item.payload}
            currencyRate={currencyRates[item.payload.region.currency]}
            onOpenArticle={onOpenArticle}
          />
        );
      },
      [currencyRates, onOpenArticle],
    );

    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        {isLoading && !error && (
          <View style={styles.centerSpinner}>
            <ActivityIndicator color={theme.textFaint} />
          </View>
        )}

        {!isLoading && error && (
          <Pressable onPress={forceRefresh} style={styles.errorBox}>
            <Text
              style={{
                fontFamily: font(aes, 'eyebrow', 600),
                fontSize: 9.5,
                letterSpacing: 1.8,
                color: theme.textFaint,
                textTransform: 'uppercase',
              }}
            >
              Couldn't load
            </Text>
            <Text style={{ fontFamily: font(aes, 'body'), fontSize: 14, color: theme.textDim }}>
              Tap to retry
            </Text>
          </Pressable>
        )}

        {digest && visible.length === 0 && !hasGlobal && (
          <View style={styles.emptyBox}>
            <Text
              style={{
                fontFamily: font(aes, 'eyebrow', 600),
                fontSize: 9.5,
                letterSpacing: 1.8,
                color: theme.textFaint,
                textTransform: 'uppercase',
                marginBottom: 10,
              }}
            >
              No stories
            </Text>
            <Text
              style={{
                fontFamily: font(aes, 'body'),
                fontSize: 14,
                lineHeight: 22,
                color: theme.textDim,
                textAlign: 'center',
              }}
            >
              No digest available for your selected regions on this date.
            </Text>
          </View>
        )}

        {digest && (visible.length > 0 || hasGlobal) && (
          <FlatList
            ref={flatRef}
            data={listData}
            keyExtractor={(item) => item.key}
            showsVerticalScrollIndicator={false}
            refreshing={refreshing}
            onRefresh={isToday ? onRefresh : undefined}
            onScrollToIndexFailed={onScrollToIndexFailed}
            renderItem={renderItem}
            removeClippedSubviews
            maxToRenderPerBatch={8}
            windowSize={5}
            ListHeaderComponent={
              <View style={styles.metaRow}>
                <Text
                  style={{
                    fontFamily: font(aes, 'eyebrow', 600),
                    fontSize: 10,
                    letterSpacing: 1.8,
                    color: theme.textFaint,
                    textTransform: 'uppercase',
                  }}
                >
                  {totalHeadlines} stories · {visible.length} regions
                </Text>
              </View>
            }
            ListFooterComponent={
              <View style={styles.footer}>
                <Text
                  style={{
                    fontFamily: font(aes, 'eyebrow', 600),
                    fontSize: 10,
                    letterSpacing: 2.2,
                    color: theme.textFaint,
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}
                >
                  — End of digest —
                </Text>
                <Text
                  style={{
                    fontFamily: font(aes, 'body'),
                    fontSize: 13,
                    lineHeight: 20,
                    color: theme.textDim,
                    maxWidth: 280,
                    textAlign: 'center',
                  }}
                >
                  Tomorrow's pulse arrives at {notifyTime}.
                </Text>
              </View>
            }
          />
        )}

        <JumpModal
          open={jumpOpen}
          onClose={() => setJumpOpen(false)}
          visible={visible}
          hasGlobal={hasGlobal}
          jumpTo={jumpTo}
        />
      </View>
    );
  }),
);

const styles = StyleSheet.create({
  metaRow: { paddingVertical: 5, alignItems: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 32, alignItems: 'center' },
  centerSpinner: { paddingVertical: 60, alignItems: 'center' },
  errorBox: { paddingVertical: 60, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { paddingVertical: 60, paddingHorizontal: 32, alignItems: 'center' },
});
