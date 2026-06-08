# Swipe Fix + Article & Global Hero Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix swipe gesture misfires in the day-pager and article overlay; add full-bleed 16:9 hero images to the article summary screen and the #1 global headline card.

**Architecture:** Three isolated changes — two `failOffsetY` threshold tweaks (ArticleScreen, ArticleReader), one component swap in DigestPager (RNGH `ScrollView` via `createAnimatedComponent`), and two conditional `HeadlineImage` blocks (ArticleScreen + GlobalSection). No new dependencies, no data-layer changes, no cron changes.

**Tech Stack:** React Native, Reanimated 3, react-native-gesture-handler, expo-image (via existing `HeadlineImage` component), Zustand (`prefs.imagesEnabled`)

---

## Setup

- [ ] **Create feature branch**

```bash
git checkout develop
git checkout -b feat/swipe-hero-images
```

---

## Task 1: Tighten failOffsetY — ArticleScreen + ArticleReader

**Files:**

- Modify: `app/src/screens/ArticleScreen.tsx` (pan gesture definition, ~line 82)
- Modify: `app/src/screens/ArticleReader.tsx` (pan gesture definition, ~line 104)

Gesture threshold changes can't be unit-tested without a gesture simulator. Verify on device after Task 5's manual checklist.

- [ ] **Step 1: Edit ArticleScreen.tsx**

In `app/src/screens/ArticleScreen.tsx`, find the pan gesture (inside `useMemo`). Change:

```ts
.failOffsetY([-20, 20])
```

to:

```ts
.failOffsetY([-10, 10])
```

- [ ] **Step 2: Edit ArticleReader.tsx**

In `app/src/screens/ArticleReader.tsx`, find the pan gesture (inside `useMemo`). Change:

```ts
.failOffsetY([-20, 20])
```

to:

```ts
.failOffsetY([-10, 10])
```

- [ ] **Step 3: Typecheck**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/screens/ArticleScreen.tsx app/src/screens/ArticleReader.tsx
git commit -m "fix(gesture): tighten failOffsetY to [-10,10] in article screens"
```

---

## Task 2: DigestPager — switch to RNGH ScrollView

**Files:**

- Modify: `app/src/components/DigestPager.tsx`

RNGH's `ScrollView` participates in the RNGH gesture responder chain and properly yields to inner vertical scrolls when the touch direction is ambiguous. All existing scroll props transfer unchanged.

- [ ] **Step 1: Add RNGH import and create AnimatedPager**

In `app/src/components/DigestPager.tsx`, add after the existing import block (before the first constant):

```ts
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';

const AnimatedPager = Animated.createAnimatedComponent(GHScrollView);
```

- [ ] **Step 2: Update the ref type**

Change:

```ts
const scrollRef = useRef<Animated.ScrollView>(null);
```

to:

```ts
const scrollRef = useRef<GHScrollView>(null);
```

- [ ] **Step 3: Replace ScrollView tags**

Replace:

```tsx
<Animated.ScrollView
```

with:

```tsx
<AnimatedPager
```

Replace:

```tsx
</Animated.ScrollView>
```

with:

```tsx
</AnimatedPager>
```

All props (`ref`, `horizontal`, `pagingEnabled`, `showsHorizontalScrollIndicator`, `onScroll`, `scrollEventThrottle`, `onMomentumScrollEnd`, `contentOffset`, `onLayout`, `style`) stay as-is.

- [ ] **Step 4: Typecheck**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors. If the ref type causes a type error, change `useRef<GHScrollView>(null)` to `useRef<ScrollView>(null)` with `ScrollView` imported from `'react-native'` — the `scrollTo` interface is compatible.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/DigestPager.tsx
git commit -m "fix(gesture): use RNGH ScrollView in DigestPager for proper direction locking"
```

---

## Task 3: ArticleScreen hero image (TDD)

**Files:**

- Modify: `app/src/tests/screens/ArticleScreen.test.tsx`
- Modify: `app/src/screens/ArticleScreen.tsx`

- [ ] **Step 1: Write the failing tests**

Add a `describe('hero image', ...)` block inside the existing `describe('ArticleScreen', ...)` in `app/src/tests/screens/ArticleScreen.test.tsx`:

```ts
describe('hero image', () => {
  const withImage = { ...headline, imageUrl: 'https://img.example.com/hero.jpg' };

  it('renders hero image when imageUrl is set and imagesEnabled is true', () => {
    useAppStore.setState({
      prefs: {
        ...DEFAULT_PREFERENCES,
        theme: 'light',
        aesthetic: 'editorial',
        imagesEnabled: true,
      },
    });
    const { getByTestId } = renderArticle(withImage);
    expect(getByTestId('hero-image')).toBeTruthy();
  });

  it('does not render hero image when imagesEnabled is false', () => {
    useAppStore.setState({
      prefs: {
        ...DEFAULT_PREFERENCES,
        theme: 'light',
        aesthetic: 'editorial',
        imagesEnabled: false,
      },
    });
    const { queryByTestId } = renderArticle(withImage);
    expect(queryByTestId('hero-image')).toBeNull();
  });

  it('does not render hero image when imageUrl is absent', () => {
    useAppStore.setState({
      prefs: {
        ...DEFAULT_PREFERENCES,
        theme: 'light',
        aesthetic: 'editorial',
        imagesEnabled: true,
      },
    });
    const { queryByTestId } = renderArticle(headline); // headline has no imageUrl
    expect(queryByTestId('hero-image')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd app && npx jest src/tests/screens/ArticleScreen.test.tsx --no-coverage
```

Expected: 3 new tests FAIL ("Unable to find an element with testID: hero-image").

- [ ] **Step 3: Implement the hero image**

In `app/src/screens/ArticleScreen.tsx`:

Add `HeadlineImage` import (with the other component imports near the top):

```ts
import { HeadlineImage } from '../components/HeadlineImage';
```

Add `imagesEnabled` store read inside the component (after the existing store reads):

```ts
const imagesEnabled = useAppStore((s) => s.prefs.imagesEnabled);
```

In the `ScrollView` content, insert the hero block **before** the title `<Text>` element:

```tsx
{
  imagesEnabled && headline.imageUrl ? (
    <HeadlineImage
      uri={headline.imageUrl}
      testID="hero-image"
      aspectRatio={16 / 9}
      style={{ width: W, marginHorizontal: -22, marginTop: -22 }}
    />
  ) : null;
}
```

`W` is already available from `useWindowDimensions`. The negative margins cancel the `contentContainerStyle`'s `paddingHorizontal: 22` and `paddingTop: 22`, making the image bleed to screen edges. `width: W` overrides `HeadlineImage`'s default `width: '100%'` (which would be content-area width) so the image is truly full-screen-width.

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd app && npx jest src/tests/screens/ArticleScreen.test.tsx --no-coverage
```

Expected: all tests PASS, including the 3 new ones.

- [ ] **Step 5: Typecheck**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/ArticleScreen.tsx app/src/tests/screens/ArticleScreen.test.tsx
git commit -m "feat(app): add full-bleed hero image to ArticleScreen"
```

---

## Task 4: GlobalSection hero card (TDD)

**Files:**

- Create: `app/src/tests/components/GlobalSection.test.tsx`
- Modify: `app/src/components/GlobalSection.tsx`

- [ ] **Step 1: Write the failing tests**

Create `app/src/tests/components/GlobalSection.test.tsx`:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { GlobalSection } from '../../components/GlobalSection';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import type { GlobalHeadline, Region } from '../../types';

const gh = (n: number, imageUrl?: string): GlobalHeadline => ({
  title: `Global ${n}`,
  summary: `Summary ${n}`,
  url: `https://example.com/${n}`,
  sourceName: 'Test Source',
  region: 'TestRegion',
  imageUrl,
});

function setPrefs(imagesEnabled: boolean): void {
  useAppStore.setState({
    prefs: { ...DEFAULT_PREFERENCES, theme: 'light', aesthetic: 'editorial', imagesEnabled },
  });
}

beforeEach(() => setPrefs(true));

describe('GlobalSection hero image', () => {
  it('renders hero image for headline #1 when imageUrl set and imagesEnabled', () => {
    const { getByTestId } = render(
      <GlobalSection
        headlines={[gh(1, 'https://img.example.com/1.jpg'), gh(2)]}
        onOpenArticle={jest.fn()}
      />,
    );
    expect(getByTestId('global-hero-image')).toBeTruthy();
  });

  it('does not render hero image when imagesEnabled is false', () => {
    setPrefs(false);
    const { queryByTestId } = render(
      <GlobalSection
        headlines={[gh(1, 'https://img.example.com/1.jpg'), gh(2)]}
        onOpenArticle={jest.fn()}
      />,
    );
    expect(queryByTestId('global-hero-image')).toBeNull();
  });

  it('does not render hero image when headline #1 has no imageUrl', () => {
    const { queryByTestId } = render(
      <GlobalSection headlines={[gh(1), gh(2)]} onOpenArticle={jest.fn()} />,
    );
    expect(queryByTestId('global-hero-image')).toBeNull();
  });

  it('renders exactly one hero image even when multiple headlines have imageUrl', () => {
    const { queryAllByTestId } = render(
      <GlobalSection
        headlines={[gh(1, 'https://img.example.com/1.jpg'), gh(2, 'https://img.example.com/2.jpg')]}
        onOpenArticle={jest.fn()}
      />,
    );
    expect(queryAllByTestId('global-hero-image')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd app && npx jest src/tests/components/GlobalSection.test.tsx --no-coverage
```

Expected: 4 tests FAIL (component renders but `global-hero-image` testID not found).

- [ ] **Step 3: Implement the hero card**

In `app/src/components/GlobalSection.tsx`:

Add `HeadlineImage` import (with other component imports):

```ts
import { HeadlineImage } from './HeadlineImage';
```

Add `imagesEnabled` store read in `GlobalSectionImpl` (after the existing `theme`/`aes` reads):

```ts
const imagesEnabled = useAppStore((s) => s.prefs.imagesEnabled);
```

Between the closing `</View>` of `regionHeader` and the `{headlines.map(...)}` call, insert:

```tsx
{
  imagesEnabled && headlines[0]?.imageUrl ? (
    <HeadlineImage uri={headlines[0].imageUrl} testID="global-hero-image" aspectRatio={16 / 9} />
  ) : null;
}
```

The `GlobalSection` container has no horizontal padding, so the image naturally spans full width with no margin adjustments needed.

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd app && npx jest src/tests/components/GlobalSection.test.tsx --no-coverage
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Typecheck**

```bash
cd app && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/GlobalSection.tsx app/src/tests/components/GlobalSection.test.tsx
git commit -m "feat(app): add hero image card for #1 global headline"
```

---

## Task 5: Full validation + PR

- [ ] **Step 1: Run full app test suite**

```bash
cd app && npx jest --no-coverage
```

Expected: all suites pass.

- [ ] **Step 2: Run cron tests**

```bash
cd cron && npm test
```

Expected: 17 suites, 167+ tests pass.

- [ ] **Step 3: Final typecheck (both packages)**

```bash
cd app && npx tsc --noEmit && cd ../cron && npx tsc --noEmit
```

Expected: no errors in either package.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feat/swipe-hero-images
gh pr create \
  --title "feat(app): swipe fix + article & global hero images" \
  --base develop \
  --body "$(cat <<'EOF'
## Summary

- Fix swipe sensitivity: tighten \`failOffsetY\` ±20 → ±10 in ArticleScreen and ArticleReader; swap DigestPager's \`Animated.ScrollView\` for RNGH's \`ScrollView\` so the day-pager yields to inner vertical scrolls
- Add full-bleed 16:9 hero image at the top of ArticleScreen (gated on \`imagesEnabled\` + \`imageUrl\`)
- Add hero image card for the #1 global headline in GlobalSection (same gate); headlines #2–N unchanged

## Test Plan

- [ ] Vertical scroll in digest does not accidentally switch days
- [ ] Vertical scroll in ArticleScreen does not trigger dismiss or open; deliberate rightward swipe still closes, leftward swipe still opens
- [ ] Hero image renders at top of ArticleScreen when article has imageUrl and images are enabled
- [ ] Hero image absent in ArticleScreen when images disabled or imageUrl missing (no blank gap)
- [ ] Hero image renders for global headline #1 when imageUrl set and images enabled
- [ ] Headlines #2–N in GlobalSection show no hero image
- [ ] Images disabled → both hero surfaces hidden, no blank gaps
- [ ] All app and cron tests pass
EOF
)"
```
