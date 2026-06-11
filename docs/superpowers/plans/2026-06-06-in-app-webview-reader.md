# In-App WebView Article Reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the external Custom Tab with an in-app `ArticleReader` (Layer 3) that renders the full article in a `react-native-webview`, supports app-controlled back via hardware button and left-edge swipe, and reveals the summary layer beneath on interactive exit.

**Architecture:** Three new nav-store fields (`readerUrl`, `readerCanGoBack`, `readerBackFn`) drive a new `ArticleReader` component whose `translateX` SharedValue handles slide-in and gesture-back. `App.tsx` gains a top rung in the `BackHandler` chain (reader → article → settings → digest) and renders `<ArticleReader>` above `<ArticleScreen>`. `ArticleScreen.openArticle` switches from `openExternalUrl` to `setReaderUrl`; `ArticleScreen` is only ever shown in `in-app` mode, so no mode-check is needed there.

**Tech Stack:** React Native (Expo, Android-first), TypeScript, `react-native-webview@13.16.1`, `react-native-reanimated`, `react-native-gesture-handler`, Zustand, Jest + RNTL (`@testing-library/react-native`).

---

## File Structure

**New files:**

- `app/src/utils/reader.ts` — `resolveReaderBack` pure helper
- `app/src/screens/ArticleReader.tsx` — WebView reader component with slide-in + gesture back
- `app/__mocks__/react-native-webview.ts` — controllable mock for RNTL tests
- `app/src/tests/utils/reader.test.ts` — unit tests for `resolveReaderBack`
- `app/src/tests/screens/ArticleReader.test.tsx` — component tests

**Modified files:**

- `app/src/store/slices/nav.ts` — add `readerUrl`, `readerCanGoBack`, `readerBackFn` and setters
- `app/App.tsx` — subscribe to reader state, extend `BackHandler`, render `<ArticleReader>`
- `app/src/screens/ArticleScreen.tsx` — `openArticle` calls `setReaderUrl` instead of `openExternalUrl`
- `app/src/tests/screens/ArticleScreen.test.tsx` — update routing assertion

---

## Task 1: Install react-native-webview

**Files:**

- Modify: `app/package.json` (via expo install)

- [ ] **Step 1: Install the package**

Run from the repo root:

```bash
cd app && npx expo install react-native-webview@13.16.1
```

Expected: `"react-native-webview": "13.16.1"` appears in `app/package.json` dependencies.

> **Note:** This is a native module — the EAS dev-client must be rebuilt before on-device testing. Jest uses the mock added in Task 2; no rebuild needed for the test suite.

- [ ] **Step 2: Commit**

```bash
git add app/package.json app/package-lock.json
git commit -m "feat: add react-native-webview@13.16.1"
```

---

## Task 2: Add react-native-webview test mock

**Files:**

- Create: `app/__mocks__/react-native-webview.ts`

This mock exposes `simulateLoad`, `simulateError`, and `simulateNavState` helpers so RNTL tests can drive state transitions without a real browser engine.

- [ ] **Step 1: Create the mock**

Create `app/__mocks__/react-native-webview.ts`:

```typescript
import React from 'react';
import { View } from 'react-native';
import type { WebViewProps, WebViewNavigation } from 'react-native-webview';

type MockRef = { goBack: jest.Mock };
interface MockInstance { props: WebViewProps; ref: MockRef | null }

let _last: MockInstance | null = null;

export function getMockWebView(): MockInstance {
  if (!_last) throw new Error('No WebView mounted');
  return _last;
}

export function simulateLoad(): void {
  _last?.props.onLoadEnd?.({ nativeEvent: {} } as never);
}

export function simulateError(): void {
  _last?.props.onError?.({ nativeEvent: { description: 'net::ERR_FAILED' } } as never);
}

export function simulateNavState(state: Partial<WebViewNavigation>): void {
  const full: WebViewNavigation = {
    url: 'https://example.com',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    navigationType: 'other',
    ...state,
  };
  _last?.props.onNavigationStateChange?.(full);
}

const WebView = React.forwardRef<MockRef, WebViewProps>((props, ref) => {
  const mockRef: MockRef = { goBack: jest.fn() };
  React.useImperativeHandle(ref, () => mockRef);
  _last = { props, ref: mockRef };
  React.useEffect(() => {
    props.onLoadStart?.({ nativeEvent: {} } as never);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View testID="mock-webview" />;
});

WebView.displayName = 'MockWebView';

export { WebView };
export default WebView;
```

- [ ] **Step 2: Commit**

```bash
git add app/__mocks__/react-native-webview.ts
git commit -m "test: add react-native-webview mock"
```

---

## Task 3: resolveReaderBack helper — TDD

**Files:**

- Create: `app/src/utils/reader.ts`
- Create: `app/src/tests/utils/reader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/src/tests/utils/reader.test.ts`:

```typescript
import { resolveReaderBack } from '../../utils/reader';

describe('resolveReaderBack', () => {
  it('returns goBack when canGoBack is true', () => {
    expect(resolveReaderBack(true)).toBe('goBack');
  });

  it('returns close when canGoBack is false', () => {
    expect(resolveReaderBack(false)).toBe('close');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npm test -- --testPathPattern="utils/reader" --no-coverage`
Expected: FAIL — `Cannot find module '../../utils/reader'`

- [ ] **Step 3: Implement the helper**

Create `app/src/utils/reader.ts`:

```typescript
export function resolveReaderBack(canGoBack: boolean): 'goBack' | 'close' {
  return canGoBack ? 'goBack' : 'close';
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npm test -- --testPathPattern="utils/reader" --no-coverage`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/utils/reader.ts app/src/tests/utils/reader.test.ts
git commit -m "feat: add resolveReaderBack helper"
```

---

## Task 4: Reader state in nav store — TDD

**Files:**

- Modify: `app/src/store/slices/nav.ts`
- Modify: `app/src/tests/store/slices/nav.test.ts`

Three fields are added:

- `readerUrl: string | null` — URL open in the reader; `null` = closed
- `readerCanGoBack: boolean` — live from `onNavigationStateChange`; read by `BackHandler`
- `readerBackFn: (() => void) | null` — imperative closure over `webViewRef.current?.goBack()`, registered by `ArticleReader` on mount

- [ ] **Step 1: Write the failing tests**

Append to `app/src/tests/store/slices/nav.test.ts` (after the last existing `describe` block):

```typescript
describe('reader state', () => {
  it('readerUrl starts null', () => {
    const s = makeStore();
    expect(s.getState().readerUrl).toBeNull();
  });

  it('setReaderUrl stores a url', () => {
    const s = makeStore();
    s.getState().setReaderUrl('https://example.com/article');
    expect(s.getState().readerUrl).toBe('https://example.com/article');
  });

  it('setReaderUrl(null) clears readerUrl', () => {
    const s = makeStore();
    s.getState().setReaderUrl('https://example.com/article');
    s.getState().setReaderUrl(null);
    expect(s.getState().readerUrl).toBeNull();
  });

  it('readerCanGoBack starts false', () => {
    const s = makeStore();
    expect(s.getState().readerCanGoBack).toBe(false);
  });

  it('setReaderCanGoBack toggles the flag', () => {
    const s = makeStore();
    s.getState().setReaderCanGoBack(true);
    expect(s.getState().readerCanGoBack).toBe(true);
    s.getState().setReaderCanGoBack(false);
    expect(s.getState().readerCanGoBack).toBe(false);
  });

  it('readerBackFn starts null', () => {
    const s = makeStore();
    expect(s.getState().readerBackFn).toBeNull();
  });

  it('setReaderBackFn stores and clears the fn', () => {
    const s = makeStore();
    const fn = jest.fn();
    s.getState().setReaderBackFn(fn);
    expect(s.getState().readerBackFn).toBe(fn);
    s.getState().setReaderBackFn(null);
    expect(s.getState().readerBackFn).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npm test -- --testPathPattern="store/slices/nav" --no-coverage`
Expected: FAIL — property access errors on `readerUrl` / `setReaderUrl` etc.

- [ ] **Step 3: Extend NavSlice interface in nav.ts**

In `app/src/store/slices/nav.ts`, inside `export interface NavSlice { ... }`, add after `persistNavState: () => void;`:

```typescript
  readerUrl: string | null;
  setReaderUrl: (url: string | null) => void;
  readerCanGoBack: boolean;
  setReaderCanGoBack: (b: boolean) => void;
  readerBackFn: (() => void) | null;
  setReaderBackFn: (fn: (() => void) | null) => void;
```

- [ ] **Step 4: Add initial values and setters to createNavSlice**

In `createNavSlice`, after `article: null,` add the initial values:

```typescript
  readerUrl: null,
  readerCanGoBack: false,
  readerBackFn: null,
```

After the existing `setArticle` implementation, add the three setters:

```typescript
  setReaderUrl: (url) => set({ readerUrl: url }),
  setReaderCanGoBack: (b) => set({ readerCanGoBack: b }),
  setReaderBackFn: (fn) => set({ readerBackFn: fn }),
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd app && npm test -- --testPathPattern="store/slices/nav" --no-coverage`
Expected: PASS (all prior tests + 7 new)

- [ ] **Step 6: Commit**

```bash
git add app/src/store/slices/nav.ts app/src/tests/store/slices/nav.test.ts
git commit -m "feat: add reader state to nav store"
```

---

## Task 5: ArticleReader component — TDD

**Files:**

- Create: `app/src/screens/ArticleReader.tsx`
- Create: `app/src/tests/screens/ArticleReader.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `app/src/tests/screens/ArticleReader.test.tsx`:

```typescript
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import ArticleReader from '../../screens/ArticleReader';
import {
  simulateLoad,
  simulateError,
  simulateNavState,
} from '../../../__mocks__/react-native-webview';

jest.mock('../../../modules/gesture-exclusion', () => ({
  setEdgeExclusion: jest.fn(),
}));

const url = 'https://example.com/full-article';

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    prefs: { ...DEFAULT_PREFERENCES, theme: 'light', aesthetic: 'editorial' },
  });
});

function renderReader(onClose = jest.fn()) {
  return render(<ArticleReader url={url} onClose={onClose} />);
}

describe('ArticleReader', () => {
  it('shows a loading spinner before load completes', () => {
    const { getByTestId } = renderReader();
    expect(getByTestId('reader-loading')).toBeTruthy();
  });

  it('hides the loading spinner after onLoadEnd fires', () => {
    const { queryByTestId } = renderReader();
    act(() => simulateLoad());
    expect(queryByTestId('reader-loading')).toBeNull();
  });

  it('renders the WebView', () => {
    const { getByTestId } = renderReader();
    expect(getByTestId('mock-webview')).toBeTruthy();
  });

  it('shows the source hostname in the top bar', () => {
    const { getByText } = renderReader();
    expect(getByText('example.com')).toBeTruthy();
  });

  it('renders the error overlay with Retry after onError', () => {
    const { getByTestId, queryByTestId } = renderReader();
    act(() => simulateError());
    expect(queryByTestId('reader-loading')).toBeNull();
    expect(getByTestId('reader-error')).toBeTruthy();
    expect(getByTestId('reader-retry')).toBeTruthy();
  });

  it('updates readerCanGoBack in the store via onNavigationStateChange', () => {
    renderReader();
    act(() => simulateNavState({ canGoBack: true }));
    expect(useAppStore.getState().readerCanGoBack).toBe(true);
  });

  it('registers readerBackFn in the store on mount', () => {
    renderReader();
    expect(useAppStore.getState().readerBackFn).not.toBeNull();
  });

  it('clears readerBackFn in the store on unmount', () => {
    const { unmount } = renderReader();
    unmount();
    expect(useAppStore.getState().readerBackFn).toBeNull();
  });

  it('has a Close reader button', () => {
    const { getByLabelText } = renderReader();
    expect(getByLabelText('Close reader')).toBeTruthy();
  });

  it('has an Open in browser button in the top bar', () => {
    const { getByLabelText } = renderReader();
    expect(getByLabelText('Open in browser')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npm test -- --testPathPattern="screens/ArticleReader" --no-coverage`
Expected: FAIL — `Cannot find module '../../screens/ArticleReader'`

- [ ] **Step 3: Implement ArticleReader**

Create `app/src/screens/ArticleReader.tsx`:

```tsx
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
import { resolveArticleSwipe, SWIPE_DISTANCE, SWIPE_VELOCITY } from '../utils/swipe';
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
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  const translateX = useSharedValue(W);
  const canGoBackSV = useSharedValue(false);
  const edgeHit = useSharedValue(false);

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

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([5, 999])
        .failOffsetY([-8, 8])
        .onBegin((e) => {
          edgeHit.value = e.x <= EDGE_WIDTH;
        })
        .onUpdate((e) => {
          if (!edgeHit.value) return;
          if (!canGoBackSV.value) {
            translateX.value = Math.max(0, e.translationX);
          }
        })
        .onEnd((e) => {
          if (!edgeHit.value) return;
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
          edgeHit.value = false;
        })
        .onFinalize(() => {
          edgeHit.value = false;
        }),
    [W, translateX, canGoBackSV, edgeHit, handleGoBack, handleClose],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
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
              <PulseIcon name="external-link" size={16} color={theme.text} />
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
                  color: theme.textMuted,
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
        </View>
      </Animated.View>
    </GestureDetector>
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd app && npm test -- --testPathPattern="screens/ArticleReader" --no-coverage`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/ArticleReader.tsx app/src/tests/screens/ArticleReader.test.tsx
git commit -m "feat: implement ArticleReader WebView component"
```

---

## Task 6: Wire ArticleReader into App.tsx

**Files:**

- Modify: `app/App.tsx`

- [ ] **Step 1: Add imports**

After the `import ArticleScreen` line (line 41), add:

```typescript
import ArticleReader from './src/screens/ArticleReader';
import { resolveReaderBack } from './src/utils/reader';
```

- [ ] **Step 2: Subscribe to reader state in RootScreens**

In the `RootScreens` function body, after the `const setScreen = useAppStore(...)` line (line 134), add:

```typescript
const readerUrl = useAppStore((s) => s.readerUrl);
const setReaderUrl = useAppStore((s) => s.setReaderUrl);
```

- [ ] **Step 3: Extend the BackHandler effect**

Replace the existing `useEffect` BackHandler block (lines 163–176) with:

```typescript
useEffect(() => {
  const sub = BackHandler.addEventListener('hardwareBackPress', () => {
    const state = useAppStore.getState();
    if (state.readerUrl) {
      const action = resolveReaderBack(state.readerCanGoBack);
      if (action === 'goBack') {
        state.readerBackFn?.();
      } else {
        state.setReaderUrl(null);
      }
      return true;
    }
    if (article) {
      setArticle(null);
      return true;
    }
    if (screen === 'settings') {
      setScreen('digest');
      return true;
    }
    return false;
  });
  return () => sub.remove();
}, [article, screen, setArticle, setScreen]);
```

The reader rung reads from `getState()` (no stale-closure risk); existing `article`/`screen` deps are unchanged.

- [ ] **Step 4: Render ArticleReader above ArticleScreen**

In the `return` block of `RootScreens`, replace:

```tsx
{
  article && (
    <ArticleScreen headline={article.h} region={article.r} onClose={() => setArticle(null)} />
  );
}
```

With:

```tsx
{
  article && (
    <ArticleScreen headline={article.h} region={article.r} onClose={() => setArticle(null)} />
  );
}
{
  readerUrl && <ArticleReader url={readerUrl} onClose={() => setReaderUrl(null)} />;
}
```

- [ ] **Step 5: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exit 0, no errors

- [ ] **Step 6: Commit**

```bash
git add app/App.tsx
git commit -m "feat: wire ArticleReader into RootScreens and BackHandler"
```

---

## Task 7: Update ArticleScreen open action + test

**Files:**

- Modify: `app/src/screens/ArticleScreen.tsx`
- Modify: `app/src/tests/screens/ArticleScreen.test.tsx`

`ArticleScreen` is only ever shown in `in-app` mode — the `onOpenArticle` routing gate in `App.tsx` already ensures this. So `openArticle` unconditionally calls `setReaderUrl`.

- [ ] **Step 1: Update the failing test first**

In `app/src/tests/screens/ArticleScreen.test.tsx`:

Remove lines 3 and 10–12 (the `expo-web-browser` import and mock):

```typescript
import * as WebBrowser from 'expo-web-browser';
```

```typescript
jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn().mockResolvedValue(undefined),
}));
```

Replace the `'opens the browser with no options when Read full article is pressed'` test (lines 60–64) with:

```typescript
it('opens the reader when Read full article is pressed', () => {
  const { getByLabelText } = renderArticle();
  fireEvent.press(getByLabelText('Read full article'));
  expect(useAppStore.getState().readerUrl).toBe(headline.url);
});
```

- [ ] **Step 2: Run to verify the updated test fails**

Run: `cd app && npm test -- --testPathPattern="screens/ArticleScreen" --no-coverage`
Expected: FAIL — `readerUrl` is `null` (store action not yet called)

- [ ] **Step 3: Update openArticle in ArticleScreen.tsx**

In `app/src/screens/ArticleScreen.tsx`:

Remove the import on line 19:

```typescript
import { openExternalUrl } from '../utils/openExternalUrl';
```

Replace lines 68–70:

```typescript
const openArticle = useCallback((): void => {
  openExternalUrl(headline.url);
}, [headline.url]);
```

With:

```typescript
const setReaderUrl = useAppStore((s) => s.setReaderUrl);

const openArticle = useCallback((): void => {
  setReaderUrl(headline.url);
}, [headline.url, setReaderUrl]);
```

- [ ] **Step 4: Run to verify the test passes**

Run: `cd app && npm test -- --testPathPattern="screens/ArticleScreen" --no-coverage`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add app/src/screens/ArticleScreen.tsx app/src/tests/screens/ArticleScreen.test.tsx
git commit -m "feat: ArticleScreen opens in-app reader instead of external browser"
```

---

## Task 8: Full suite — typecheck, lint, tests

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: exit 0

- [ ] **Step 2: Lint**

Run: `cd app && npx eslint --ext .ts,.tsx src`
Expected: exit 0

- [ ] **Step 3: Full test suite**

Run: `cd app && npm test -- --no-coverage`
Expected: PASS — all prior tests + new reader/helper tests

- [ ] **Step 4: Commit any lint fixes**

If lint required changes:

```bash
git add -p
git commit -m "fix: lint cleanup for webview reader"
```

---

## Manual on-device verification checklist

After rebuilding the dev-client (`npx expo run:android`):

- [ ] Tap headline → summary screen appears
- [ ] Tap "Read full article" → `ArticleReader` slides in from the right, WebView loads
- [ ] Hardware back while page history exists → steps back through WebView history
- [ ] Hardware back at root article → closes reader, summary beneath is revealed
- [ ] Left-edge swipe at root article → finger-tracks, release past threshold closes reader
- [ ] Left-edge swipe mid-page or non-left-edge → WebView scrolls normally (gesture doesn't arm)
- [ ] "Open in browser" in top bar → Chrome opens the URL
- [ ] Airplane mode → error fallback card appears; "Open in browser" and "Retry" both work
- [ ] First visit to a cookie-consent domain → banner appears once; second open of same domain → banner gone
- [ ] `'browser'` mode (Settings → Open links in browser) → headline taps skip summary/reader entirely
