import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, THEMES, AESTHETICS } from '../themes';
import { useAppStore } from '../store';
import PulseIcon from '../components/Icon';
import { openExternalUrl } from '../utils/openExternalUrl';
import {
  resolveArticleSwipe,
  SWIPE_DISTANCE,
  SWIPE_VELOCITY,
  READER_EDGE_ACTIVE_OFFSET_X,
} from '../utils/swipe';
import { setEdgeExclusion } from '../../modules/gesture-exclusion';

const EDGE_WIDTH = 40;

interface Props {
  url: string;
  onClose: () => void;
}

export default function ArticleReader({ url, onClose }: Props): React.ReactElement {
  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const setReaderCanGoBack = useAppStore((s) => s.setReaderCanGoBack);
  const setReaderBackFn = useAppStore((s) => s.setReaderBackFn);
  const insets = useSafeAreaInsets();
  const { width: W } = useWindowDimensions();
  const webViewRef = useRef<WebView>(null);
  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const translateX = useSharedValue(W);
  const canGoBackSV = useSharedValue(false);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    translateX.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    setEdgeExclusion(true);
    setReaderBackFn(() => webViewRef.current?.goBack());
    return () => {
      setEdgeExclusion(false);
      setReaderBackFn(null);
    };
  }, [setReaderBackFn]);

  const handleClose = useCallback(() => {
    if (!mountedRef.current) return;
    onClose();
  }, [onClose]);

  const handleGoBack = useCallback(() => {
    webViewRef.current?.goBack();
  }, []);

  const animateClose = useCallback(() => {
    translateX.value = withTiming(W, { duration: 200, easing: Easing.in(Easing.cubic) }, () => {
      runOnJS(handleClose)();
    });
  }, [W, translateX, handleClose]);

  const handleNavigationStateChange = useCallback(
    (navState: WebViewNavigation) => {
      canGoBackSV.value = navState.canGoBack;
      setReaderCanGoBack(navState.canGoBack);
    },
    [canGoBackSV, setReaderCanGoBack],
  );

  const hostname = useMemo(() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }, [url]);

  // Gesture lives on the left-edge strip only — WebView receives all other touches directly.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([READER_EDGE_ACTIVE_OFFSET_X, 999])
        .failOffsetY([-10, 10])
        .onUpdate((e) => {
          if (!canGoBackSV.value) {
            translateX.value = Math.max(0, e.translationX);
          }
        })
        .onEnd((e) => {
          if (canGoBackSV.value) {
            if (e.translationX > SWIPE_DISTANCE || e.velocityX > SWIPE_VELOCITY) {
              runOnJS(handleGoBack)();
            }
          } else {
            const action = resolveArticleSwipe(e.translationX, e.velocityX);
            if (action === 'close') {
              translateX.value = withTiming(
                W,
                { duration: 200, easing: Easing.in(Easing.cubic) },
                () => {
                  runOnJS(handleClose)();
                },
              );
            } else {
              translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
            }
          }
        }),
    [W, translateX, canGoBackSV, handleGoBack, handleClose],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, zIndex: 200 }, animatedStyle]}
    >
      <View
        style={[
          s.topBar,
          {
            paddingTop: insets.top,
            backgroundColor: theme.surface,
            borderBottomColor: theme.rule,
          },
        ]}
      >
        <View style={s.topBarRow}>
          <Pressable
            onPress={animateClose}
            style={[s.barBtn, { backgroundColor: theme.chip }]}
            hitSlop={6}
            accessibilityLabel="Close reader"
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
            {hostname}
          </Text>
          <Pressable
            onPress={() => openExternalUrl(url)}
            style={[s.barBtn, { backgroundColor: theme.chip }]}
            hitSlop={6}
            accessibilityLabel="Open in browser"
          >
            <PulseIcon name="link" size={16} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <View style={s.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: url }}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setHasError(true);
          }}
          onHttpError={() => {
            setLoading(false);
            setHasError(true);
          }}
          onNavigationStateChange={handleNavigationStateChange}
          setSupportMultipleWindows={false}
          style={{ flex: 1, backgroundColor: theme.bg }}
        />

        {loading && (
          <View style={[s.overlay, { backgroundColor: theme.bg }]} testID="reader-loading">
            <ActivityIndicator size="large" color={theme.accent} />
          </View>
        )}

        {hasError && (
          <View style={[s.overlay, { backgroundColor: theme.bg }]} testID="reader-error">
            <Text
              style={{
                fontFamily: font(aes, 'body', 400),
                fontSize: 15,
                color: theme.textDim,
                marginBottom: 24,
                textAlign: 'center',
              }}
            >
              Could not load the article.
            </Text>
            <Pressable
              onPress={() => {
                setHasError(false);
                setLoading(true);
              }}
              style={[s.errorBtn, { borderColor: theme.ruleStrong }]}
              accessibilityLabel="Retry"
              testID="reader-retry"
            >
              <Text style={{ fontFamily: font(aes, 'ui', 600), fontSize: 13, color: theme.text }}>
                Retry
              </Text>
            </Pressable>
            <Pressable
              onPress={() => openExternalUrl(url)}
              style={[s.errorBtn, { borderColor: theme.ruleStrong, marginTop: 10 }]}
              accessibilityLabel="Open in browser"
            >
              <Text style={{ fontFamily: font(aes, 'ui', 600), fontSize: 13, color: theme.text }}>
                Open in browser
              </Text>
            </Pressable>
          </View>
        )}

        {/* Edge strip: gesture lives here only — WebView is unimpeded everywhere else */}
        <GestureDetector gesture={pan}>
          <View style={s.edgeStrip} />
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  topBar: { borderBottomWidth: StyleSheet.hairlineWidth },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  barBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webViewContainer: { flex: 1 },
  edgeStrip: { position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE_WIDTH },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
  },
});
