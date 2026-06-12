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
import { trackEvent } from '../analytics/track';
import { useAppStore } from '../store';
import PulseIcon from '../components/Icon';
import Flag from '../components/Flag';
import { HeadlineImage } from '../components/HeadlineImage';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { resolveArticleSwipe, ARTICLE_ACTIVE_OFFSET_X } from '../utils/swipe';
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
  const setReaderUrl = useAppStore((s) => s.setReaderUrl);
  const imagesEnabled = useAppStore((s) => s.prefs.imagesEnabled);
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guards onClose so it fires exactly once across the back button + gesture paths.
  const closedRef = useRef(false);
  // Off-screen to the right; slides to 0 on mount, follows the finger on drag.
  const translateX = useSharedValue(W);

  useEffect(() => {
    translateX.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    setEdgeExclusion(true);
    trackEvent('article_open', { region: region.code, url: headline.url });
    return () => {
      setEdgeExclusion(false);
    };
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

  const openArticle = useCallback((): void => {
    trackEvent('article_read', { region: region.code, url: headline.url });
    setReaderUrl(headline.url);
  }, [headline.url, region.code, setReaderUrl]);

  const animateClose = useCallback(() => {
    translateX.value = withTiming(W, { duration: 200, easing: Easing.in(Easing.cubic) }, () => {
      runOnJS(handleClose)();
    });
  }, [W, translateX, handleClose]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-ARTICLE_ACTIVE_OFFSET_X, ARTICLE_ACTIVE_OFFSET_X])
        .failOffsetY([-10, 10])
        .onUpdate((e) => {
          // Track the finger 1:1 in the close direction; clamp the open direction at 0.
          translateX.value = Math.max(0, e.translationX);
        })
        .onEnd((e) => {
          const action = resolveArticleSwipe(e.translationX, e.velocityX);
          if (action === 'close') {
            translateX.value = withTiming(
              W,
              { duration: 200, easing: Easing.in(Easing.cubic) },
              () => {
                runOnJS(handleClose)();
              },
            );
          } else if (action === 'open') {
            translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
            runOnJS(openArticle)();
          } else {
            translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
          }
        }),
    [W, handleClose, openArticle],
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
    void Clipboard.setStringAsync(headline.url)
      .then(() => {
        setCopied(true);
        if (copyTimer.current) clearTimeout(copyTimer.current);
        copyTimer.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // clipboard unavailable on this device — silent failure is acceptable
      });
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, zIndex: 100 }, animatedStyle]}
      >
        <View
          style={[
            s.header,
            {
              paddingTop: insets.top,
              backgroundColor: theme.surface,
              borderBottomColor: theme.rule,
            },
          ]}
        >
          <View style={s.headerRow}>
            <Pressable
              onPress={animateClose}
              style={[s.headerBtn, { backgroundColor: theme.chip }]}
              hitSlop={6}
              accessibilityLabel="Back to digest"
            >
              <PulseIcon name="arrow-left" size={16} color={theme.text} />
            </Pressable>

            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                textAlign: 'center',
                marginHorizontal: 12,
                fontFamily: font(aes, 'eyebrow', 600),
                fontSize: 10,
                letterSpacing: 2,
                color: theme.accent,
                textTransform: 'uppercase',
              }}
            >
              {headline.sourceName ?? 'Article'}
            </Text>

            <View style={s.headerBtn} />
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {imagesEnabled && headline.imageUrl ? (
            <Pressable
              onPress={() => setViewerOpen(true)}
              accessibilityLabel="View image full size"
              testID="hero-image-press"
            >
              <HeadlineImage
                uri={headline.imageUrl}
                testID="hero-image"
                aspectRatio={16 / 9}
                style={{ width: W, marginHorizontal: -22, marginTop: -22, marginBottom: 20 }}
              />
            </Pressable>
          ) : null}
          <Text
            style={{
              fontFamily: font(aes, 'title', 700),
              fontSize: 22,
              lineHeight: 27,
              letterSpacing: -0.4,
              color: theme.text,
            }}
          >
            {headline.title}
          </Text>

          <View style={[s.byline, { borderBottomColor: theme.rule }]}>
            <Flag
              country={region.country?.length === 2 ? region.country : region.code}
              width={32}
              height={22}
            />
            <Text
              numberOfLines={1}
              style={{
                marginLeft: 14,
                flex: 1,
                fontFamily: font(aes, 'body'),
                fontSize: 18,
                color: theme.textDim,
              }}
            >
              {region.region}
            </Text>
            {headline.category && (
              <View style={[s.categoryChip, { backgroundColor: theme.accentSoft, marginLeft: 10 }]}>
                <Text
                  style={{
                    fontFamily: font(aes, 'eyebrow', 600),
                    fontSize: 10,
                    letterSpacing: 1.4,
                    color: theme.accent,
                    textTransform: 'uppercase',
                  }}
                >
                  {headline.category}
                </Text>
              </View>
            )}
          </View>

          <View style={[s.summaryBlock, { borderLeftColor: theme.accent }]}>
            <Text
              style={{
                fontFamily: font(aes, 'body', 600),
                fontSize: 16,
                lineHeight: 24,
                color: theme.text,
              }}
            >
              {headline.summary}
            </Text>
          </View>

          {headline.detail && (
            <Text
              style={{
                fontFamily: font(aes, 'body'),
                fontSize: 16,
                lineHeight: 26,
                color: theme.textDim,
                marginTop: 16,
              }}
            >
              {headline.detail}
            </Text>
          )}

          <Pressable
            onPress={openArticle}
            accessibilityLabel="Read full article"
            style={({ pressed }) => [
              s.readBtn,
              { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1, marginTop: 28 },
            ]}
          >
            <Text
              style={{
                fontFamily: font(aes, 'ui', 600),
                fontSize: 15,
                color: '#fff',
                letterSpacing: -0.1,
              }}
            >
              Read full article
            </Text>
            <View style={{ marginLeft: 8 }}>
              <PulseIcon name="arrow-right" size={14} color="#fff" strokeWidth={2} />
            </View>
          </Pressable>

          <View style={[s.copyRow, { backgroundColor: theme.chip }]}>
            <Pressable
              onPress={openArticle}
              hitSlop={8}
              accessibilityLabel="Open full article"
              testID="source-link"
              style={({ pressed }) => [s.sourceInfo, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text
                numberOfLines={1}
                style={{
                  flexShrink: 1,
                  fontFamily: font(aes, 'number'),
                  fontSize: 11,
                  color: theme.accent,
                }}
              >
                {hostname}
              </Text>
              <PulseIcon name="link" size={13} color={theme.accent} strokeWidth={1.8} />
            </Pressable>
            <Pressable
              onPress={copyLink}
              accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
              style={[s.copyBtn, { borderColor: copied ? theme.accent : theme.ruleStrong }]}
            >
              <Text
                style={{
                  fontFamily: font(aes, 'ui', 600),
                  fontSize: 12,
                  color: copied ? theme.accent : theme.textDim,
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </Text>
              <PulseIcon
                name={copied ? 'check' : 'copy'}
                size={13}
                color={copied ? theme.accent : theme.textDim}
                strokeWidth={1.8}
              />
            </Pressable>
          </View>

          <View style={s.swipeHints}>
            <Text
              style={{
                fontFamily: font(aes, 'eyebrow', 600),
                fontSize: 9,
                letterSpacing: 1.4,
                color: theme.textFaint,
                textTransform: 'uppercase',
              }}
            >
              ← swipe right · close
            </Text>
            <Text
              style={{
                fontFamily: font(aes, 'eyebrow', 600),
                fontSize: 9,
                letterSpacing: 1.4,
                color: theme.textFaint,
                textTransform: 'uppercase',
              }}
            >
              swipe left · open →
            </Text>
          </View>
        </ScrollView>

        <ImageViewerModal
          uri={viewerOpen ? (headline.imageUrl ?? null) : null}
          onClose={() => setViewerOpen(false)}
        />
      </Animated.View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  byline: {
    marginTop: 14,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  summaryBlock: {
    marginTop: 18,
    paddingLeft: 14,
    borderLeftWidth: 3,
  },
  readBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  copyRow: {
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 12,
  },
  swipeHints: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 28,
    paddingHorizontal: 2,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
});
