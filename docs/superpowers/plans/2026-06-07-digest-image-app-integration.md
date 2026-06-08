# Digest Image App Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the persisted `imageUrl` on digest headlines in the RN app as a lead photo on story #1 and thumbnails on the next stories per region, gated by a new Settings "Images" group.

**Architecture:** Add `imageUrl?` to `Headline`/`GlobalHeadline` (flows through MMKV cache + Supabase fetch as plain JSON — no storage changes) and `imagesEnabled`/`photoCount` to `UserPreferences` (auto-synced by the existing prefs pipeline). A thin `HeadlineImage` wraps `expo-image`; `RegionSection` chooses a lead / thumb / text variant per headline index, rendering an image only when `imageUrl` exists (graceful text fallback). A new Settings group toggles the feature and sets the photo count.

**Tech Stack:** React Native (Expo SDK 56), `expo-image`, Zustand, MMKV, Jest + ts-jest + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-06-07-digest-image-app-integration-design.md`
**Branch:** `feat/app-digest-images` (already created and checked out)

---

## File structure

| File                                              | Responsibility                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `app/package.json`                                | add `expo-image` dependency                                                                   |
| `app/jest.config.cjs`                             | map `expo-image` to its test mock                                                             |
| `app/__mocks__/expo-image.tsx`                    | **new** — host-stub `Image` for tests                                                         |
| `app/src/types.ts`                                | `imageUrl?` on `Headline`/`GlobalHeadline`; `imagesEnabled`/`photoCount` on `UserPreferences` |
| `app/src/storage/preferences.ts`                  | defaults for the two new prefs                                                                |
| `app/src/components/HeadlineImage.tsx`            | **new** — `expo-image` wrapper (lead aspect / square thumb)                                   |
| `app/src/components/RegionSection.tsx`            | lead / thumb / text variant rendering                                                         |
| `app/src/screens/SettingsScreen.tsx`              | new "Images" `Group`                                                                          |
| `app/src/tests/storage/preferences.test.ts`       | defaults assertions                                                                           |
| `app/src/tests/components/RegionSection.test.tsx` | **new** — variant tests                                                                       |
| `app/src/tests/screens/SettingsScreen.test.tsx`   | Images group tests                                                                            |

**Note on a deliberate divergence from an existing pattern:** the "Global Headlines" group keeps its dependent `Stepper` mounted-but-dimmed when its switch is off. The approved spec/handoff instead call for the "Photos per region" stepper to be **conditionally rendered** (hidden) when `imagesEnabled` is false. Follow the spec (hide it).

---

### Task 1: Add `expo-image` + its test mock

**Files:**

- Modify: `app/package.json` (via `expo install`)
- Modify: `app/jest.config.cjs`
- Create: `app/__mocks__/expo-image.tsx`

- [ ] **Step 1: Install the SDK-compatible version**

Run: `cd app && npx expo install expo-image`
Expected: `expo-image` added to `app/package.json` `dependencies` at the version matching Expo SDK 56 (do not hand-pin a version — `expo install` resolves it).

- [ ] **Step 2: Create the Jest mock**

Create `app/__mocks__/expo-image.tsx` with this exact content:

```tsx
import React from 'react';

// Host-stub for tests: renders an "ExpoImage" node and passes props through
// (testID, source, etc.) so @testing-library queries can find it.
export function Image(props: Record<string, unknown>): React.ReactElement {
  return React.createElement('ExpoImage', props);
}
```

- [ ] **Step 3: Map the mock in Jest config**

In `app/jest.config.cjs`, add this entry to the `moduleNameMapper` object (place it right after the `^react-native$` line):

```js
    '^expo-image$': '<rootDir>/__mocks__/expo-image.tsx',
```

- [ ] **Step 4: Verify the app still typechecks and tests pass**

Run: `cd app && npx tsc --noEmit && npm test`
Expected: tsc clean; existing suites still pass (no behaviour changed yet).

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/jest.config.cjs app/__mocks__/expo-image.tsx
git commit -m "build(app): add expo-image dependency and jest mock"
```

(If `app/` has no `package-lock.json`, omit it from the `git add`.)

---

### Task 2: Extend types + preference defaults

**Files:**

- Modify: `app/src/types.ts`
- Modify: `app/src/storage/preferences.ts`
- Test: `app/src/tests/storage/preferences.test.ts`

- [ ] **Step 1: Add the failing defaults test**

In `app/src/tests/storage/preferences.test.ts`, append this `describe` block at the end of the file:

```ts
describe('DEFAULT_PREFERENCES image keys', () => {
  it('defaults images on with a photo count of 2', () => {
    expect(DEFAULT_PREFERENCES.imagesEnabled).toBe(true);
    expect(DEFAULT_PREFERENCES.photoCount).toBe(2);
  });

  it('fills image defaults when a legacy cached blob omits them', async () => {
    const { storage } = await import('../../storage/mmkv');
    // Legacy blob without the new keys.
    storage.set(
      'pulse.preferences.v1',
      JSON.stringify({ theme: 'dark', updatedAt: new Date(1).toISOString() }),
    );
    const loaded = await loadLocalPreferences();
    expect(loaded?.imagesEnabled).toBe(true);
    expect(loaded?.photoCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd app && npx jest --config jest.config.cjs src/tests/storage/preferences.test.ts`
Expected: FAIL — `imagesEnabled`/`photoCount` are `undefined` (not yet on `DEFAULT_PREFERENCES`), and TS errors that the keys don't exist on `UserPreferences`.

- [ ] **Step 3: Add the fields to `UserPreferences`**

In `app/src/types.ts`, add `imageUrl?` to `Headline` and `GlobalHeadline`, and the two new keys to `UserPreferences`. Apply these three edits.

Edit A — `Headline` (add after `sourceName?: string;`):

```ts
export interface Headline {
  title: string;
  summary: string;
  /** 3-4 sentence deep-dive. Absent on old cached digests. */
  detail?: string;
  url: string;
  category?: string;
  sourceName?: string;
  /** og:image matched by cron; absent on old cached digests. */
  imageUrl?: string;
}
```

Edit B — `GlobalHeadline` (add after `sourceName?: string;`):

```ts
export interface GlobalHeadline {
  title: string;
  summary: string;
  detail?: string;
  url: string;
  /** The source region name (e.g. "Hungary"). */
  region: string;
  sourceName?: string;
  /** og:image matched by cron; forward-compat (not rendered this slice). */
  imageUrl?: string;
}
```

Edit C — `UserPreferences` (add after `regionStyle: 'flag' | 'code';`):

```ts
regionStyle: 'flag' | 'code';
/** Master switch for digest photos. */
imagesEnabled: boolean;
/** Max stories per region that show a photo (1 = lead only). Range 1–3. */
photoCount: number;
```

- [ ] **Step 4: Add the defaults**

In `app/src/storage/preferences.ts`, add the two keys to `DEFAULT_PREFERENCES` (after `regionStyle: 'flag',`):

```ts
  regionStyle: 'flag',
  imagesEnabled: true,
  photoCount: 2,
```

- [ ] **Step 5: Update the SettingsScreen test's mocked defaults**

The SettingsScreen test mocks `DEFAULT_PREFERENCES`. In `app/src/tests/screens/SettingsScreen.test.tsx`, add the two keys to the mock object (after `regionStyle: 'flag',`) so the mock stays shape-compatible:

```ts
    regionStyle: 'flag',
    imagesEnabled: true,
    photoCount: 2,
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd app && npx jest --config jest.config.cjs src/tests/storage/preferences.test.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/types.ts app/src/storage/preferences.ts app/src/tests/storage/preferences.test.ts app/src/tests/screens/SettingsScreen.test.tsx
git commit -m "feat(app): add imageUrl headline field and image preferences"
```

---

### Task 3: `HeadlineImage` component

**Files:**

- Create: `app/src/components/HeadlineImage.tsx`

- [ ] **Step 1: Write the component**

Create `app/src/components/HeadlineImage.tsx` with this exact content:

```tsx
import React from 'react';
import type { StyleProp } from 'react-native';
import { Image, type ImageStyle } from 'expo-image';

interface HeadlineImageProps {
  uri: string;
  /** Square edge length in px (thumbnail). Mutually exclusive with aspectRatio. */
  size?: number;
  /** Width:height ratio for a full-width image (e.g. 3 / 2). Ignored when size is set. */
  aspectRatio?: number;
  radius?: number;
  /** Stable key so expo-image recycles correctly inside the digest list. */
  recyclingKey?: string;
  testID?: string;
  style?: StyleProp<ImageStyle>;
}

/** Thin expo-image wrapper. Full-width (aspectRatio) for leads, fixed square for thumbs. */
export function HeadlineImage({
  uri,
  size,
  aspectRatio = 3 / 2,
  radius = 0,
  recyclingKey,
  testID,
  style,
}: HeadlineImageProps): React.ReactElement {
  const dims: ImageStyle =
    size !== undefined ? { width: size, height: size } : { width: '100%', aspectRatio };
  return (
    <Image
      testID={testID}
      source={{ uri }}
      recyclingKey={recyclingKey}
      contentFit="cover"
      transition={200}
      style={[dims, { borderRadius: radius }, style]}
    />
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src/components/HeadlineImage.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/HeadlineImage.tsx
git commit -m "feat(app): add HeadlineImage expo-image wrapper"
```

---

### Task 4: Lead / thumb / text rendering in `RegionSection`

**Files:**

- Modify: `app/src/components/RegionSection.tsx`
- Test: `app/src/tests/components/RegionSection.test.tsx` (new)

- [ ] **Step 1: Write the failing tests**

Create `app/src/tests/components/RegionSection.test.tsx` with this exact content:

```tsx
import React from 'react';
import { render } from '@testing-library/react-native';
import { RegionSection } from '../../components/RegionSection';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import type { Headline, Region, UserPreferences } from '../../types';

const region: Region = {
  region: 'Hungary',
  country: 'HU',
  code: 'HU',
  continent: 'Europe',
  currency: 'HUF',
  sources: [],
};

const h = (n: number, withImage: boolean): Headline => ({
  title: `Headline ${n}`,
  summary: `Summary ${n}`,
  url: `https://example.com/${n}`,
  ...(withImage ? { imageUrl: `https://img.example.com/${n}.jpg` } : {}),
});

function setPrefs(over: Partial<UserPreferences>): void {
  useAppStore.setState({
    prefs: {
      ...DEFAULT_PREFERENCES,
      theme: 'light',
      aesthetic: 'editorial',
      regionStyle: 'flag',
      baseCurrency: 'USD',
      imagesEnabled: true,
      photoCount: 2,
      ...over,
    },
  });
}

function renderSection(items: Headline[]) {
  return render(<RegionSection bucket={{ region, items }} onOpenArticle={jest.fn()} />);
}

beforeEach(() => setPrefs({}));

describe('RegionSection image treatment', () => {
  it('renders a lead image on story #1 when it has imageUrl', () => {
    const { getByTestId, queryAllByTestId } = renderSection([h(1, true), h(2, false)]);
    expect(getByTestId('lead-image')).toBeTruthy();
    expect(queryAllByTestId('thumb-image')).toHaveLength(0);
  });

  it('renders a thumbnail on story #2 within photoCount when it has imageUrl', () => {
    const { getByTestId } = renderSection([h(1, true), h(2, true)]);
    expect(getByTestId('lead-image')).toBeTruthy();
    expect(getByTestId('thumb-image')).toBeTruthy();
  });

  it('falls back to a text row (no lead image) when story #1 has no imageUrl', () => {
    const { queryByTestId, getByText } = renderSection([h(1, false), h(2, false)]);
    expect(queryByTestId('lead-image')).toBeNull();
    expect(getByText('Headline 1')).toBeTruthy();
  });

  it('shows only the lead when photoCount = 1, even if #2 has an image', () => {
    setPrefs({ photoCount: 1 });
    const { getByTestId, queryAllByTestId } = renderSection([h(1, true), h(2, true)]);
    expect(getByTestId('lead-image')).toBeTruthy();
    expect(queryAllByTestId('thumb-image')).toHaveLength(0);
  });

  it('renders no images when imagesEnabled is false', () => {
    setPrefs({ imagesEnabled: false });
    const { queryByTestId } = renderSection([h(1, true), h(2, true)]);
    expect(queryByTestId('lead-image')).toBeNull();
    expect(queryByTestId('thumb-image')).toBeNull();
  });

  it('does not thumbnail a story at/after photoCount', () => {
    setPrefs({ photoCount: 2 });
    const { queryAllByTestId } = renderSection([h(1, true), h(2, true), h(3, true)]);
    // #1 lead, #2 thumb, #3 beyond range → exactly one thumb.
    expect(queryAllByTestId('thumb-image')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd app && npx jest --config jest.config.cjs src/tests/components/RegionSection.test.tsx`
Expected: FAIL — no `lead-image`/`thumb-image` test IDs exist yet.

- [ ] **Step 3: Replace `RegionSection.tsx` with the variant-aware version**

Replace the entire contents of `app/src/components/RegionSection.tsx` with:

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PressableScale } from 'react-native-pressable-scale';
import { THEMES, AESTHETICS, font } from '../themes';
import type { Theme, Aesthetic } from '../themes';
import PulseIcon from './Icon';
import Flag from './Flag';
import { CurrencyChip } from './CurrencyChip';
import { HeadlineImage } from './HeadlineImage';
import type { CurrencyRate } from '../hooks/useCurrencyRates';
import { useAppStore } from '../store';
import type { Headline, Region } from '../types';
import type { VisibleBucket } from '../hooks/useDigestPageData';

interface RegionSectionProps {
  bucket: VisibleBucket;
  currencyRate?: CurrencyRate;
  onOpenArticle: (h: Headline, r: Region) => void;
}

function SourceRow({
  h,
  theme,
  aes,
}: {
  h: Headline;
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement | null {
  if (!h.sourceName) return null;
  return (
    <View style={s.sourceRow}>
      <Text
        style={{
          fontFamily: font(aes, 'ui', 600),
          fontSize: 12,
          color: theme.accent,
          letterSpacing: -0.05,
        }}
      >
        {h.sourceName}
      </Text>
      <PulseIcon name="link" size={11} color={theme.accent} strokeWidth={1.8} />
    </View>
  );
}

function RegionSectionImpl({
  bucket,
  currencyRate,
  onOpenArticle,
}: RegionSectionProps): React.ReactElement {
  const theme = useAppStore((st) => THEMES[st.prefs.theme]);
  const aes = useAppStore((st) => AESTHETICS[st.prefs.aesthetic]);
  const themeId = useAppStore((st) => st.prefs.theme);
  const baseCurrency = useAppStore((st) => st.prefs.baseCurrency);
  const regionStyle = useAppStore((st) => st.prefs.regionStyle);
  const imagesEnabled = useAppStore((st) => st.prefs.imagesEnabled);
  const photoCount = useAppStore((st) => st.prefs.photoCount);
  const showFlags = regionStyle !== 'code';
  const imagesOn = imagesEnabled !== false;
  const pillBg = themeId === 'dark' ? 'rgba(17,17,16,0.62)' : 'rgba(255,255,255,0.64)';

  const numberStyle = {
    fontFamily: font(aes, 'number', 500),
    fontSize: aes.numberSize,
    lineHeight: 16,
    color: theme.textFaint,
    letterSpacing: 0.2,
  };
  const summaryStyle = {
    fontFamily: font(aes, 'body'),
    fontSize: aes.bodySize,
    lineHeight: aes.bodyLh,
    color: theme.textDim,
    marginTop: 8,
  };

  return (
    <View style={s.container}>
      <View
        style={[
          s.regionHeader,
          {
            borderTopColor: theme.accent,
            borderTopWidth: 2,
            borderBottomColor: theme.ruleStrong,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        {showFlags ? (
          <Flag country={bucket.region.country} width={26} height={20} />
        ) : (
          <View style={[s.codePill, { backgroundColor: theme.accentSoft }]}>
            <Text
              style={{
                fontFamily: font(aes, 'number', 600),
                fontSize: 11,
                color: theme.accent,
                letterSpacing: 0.4,
              }}
            >
              {bucket.region.code}
            </Text>
          </View>
        )}
        <View style={s.headerTitle}>
          <Text
            style={{
              fontFamily: font(aes, 'title', 600),
              fontSize: 19,
              lineHeight: 21,
              letterSpacing: -0.3,
              color: theme.accent,
            }}
          >
            {bucket.region.region}
          </Text>
          <Text
            style={{
              fontFamily: font(aes, 'eyebrow', 500),
              fontSize: 9,
              letterSpacing: 1.3,
              color: theme.textFaint,
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            {bucket.region.continent}
          </Text>
        </View>
        {currencyRate && (
          <CurrencyChip
            code={bucket.region.currency}
            baseCurrency={baseCurrency}
            rate={currencyRate}
          />
        )}
      </View>

      {bucket.items.map((h, i) => {
        const hasBorder = i < bucket.items.length - 1;
        const borderStyle = {
          borderBottomColor: theme.rule,
          borderBottomWidth: hasBorder ? StyleSheet.hairlineWidth : 0,
        };
        const isLead = imagesOn && i === 0 && !!h.imageUrl;
        const isThumb = imagesOn && i > 0 && i < photoCount && !!h.imageUrl;

        if (isLead) {
          return (
            <PressableScale
              key={`${h.url}-${i}`}
              onPress={() => onOpenArticle(h, bucket.region)}
              accessibilityLabel={h.title}
              activeScale={0.94}
              style={[s.leadRow, borderStyle]}
            >
              <View style={s.leadImageWrap}>
                <HeadlineImage
                  uri={h.imageUrl!}
                  aspectRatio={3 / 2}
                  radius={0}
                  recyclingKey={h.url}
                  testID="lead-image"
                />
                {h.sourceName ? (
                  <View style={[s.leadPill, { backgroundColor: pillBg }]}>
                    <Text
                      style={{
                        fontFamily: font(aes, 'eyebrow', 500),
                        fontSize: 8.5,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                        color: theme.textDim,
                      }}
                    >
                      {h.sourceName}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={s.leadBody}>
                <View style={s.numberCol}>
                  <Text style={numberStyle}>{i + 1}</Text>
                </View>
                <View style={s.content}>
                  <Text
                    style={{
                      fontFamily: font(aes, 'title', aes.roles.title.weight),
                      fontSize: aes.titleSize + 3,
                      lineHeight: aes.titleLh + 3,
                      letterSpacing: aes.titleLetter,
                      color: theme.text,
                    }}
                  >
                    {h.title}
                  </Text>
                  <Text style={summaryStyle}>{h.summary}</Text>
                  <SourceRow h={h} theme={theme} aes={aes} />
                </View>
              </View>
            </PressableScale>
          );
        }

        return (
          <PressableScale
            key={`${h.url}-${i}`}
            onPress={() => onOpenArticle(h, bucket.region)}
            accessibilityLabel={h.title}
            activeScale={0.94}
            style={[s.headlineRow, borderStyle]}
          >
            <View style={s.numberCol}>
              <Text style={numberStyle}>{i + 1}</Text>
            </View>
            <View style={s.content}>
              <View style={s.rowBody}>
                <View style={s.textBlock}>
                  <Text
                    style={{
                      fontFamily: font(aes, 'title', aes.roles.title.weight),
                      fontSize: aes.titleSize,
                      lineHeight: aes.titleLh,
                      letterSpacing: aes.titleLetter,
                      color: theme.text,
                    }}
                  >
                    {h.title}
                  </Text>
                  <Text style={summaryStyle}>{h.summary}</Text>
                </View>
                {isThumb ? (
                  <HeadlineImage
                    uri={h.imageUrl!}
                    size={74}
                    radius={8}
                    recyclingKey={h.url}
                    testID="thumb-image"
                    style={s.thumb}
                  />
                ) : null}
              </View>
              <SourceRow h={h} theme={theme} aes={aes} />
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

export const RegionSection = React.memo(RegionSectionImpl);

const s = StyleSheet.create({
  container: { marginTop: 16 },
  regionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headerTitle: { flex: 1, marginLeft: 10 },
  codePill: {
    width: 36,
    height: 22,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -3,
  },
  headlineRow: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  leadRow: { paddingBottom: 18 },
  leadImageWrap: { position: 'relative', width: '100%' },
  leadPill: {
    position: 'absolute',
    left: 10,
    bottom: 9,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  leadBody: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 14 },
  numberCol: { width: 32, paddingTop: 2 },
  content: { flex: 1 },
  rowBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  textBlock: { flex: 1, minWidth: 0 },
  thumb: { marginTop: 2 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 5 },
});
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd app && npx jest --config jest.config.cjs src/tests/components/RegionSection.test.tsx`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Typecheck + lint**

Run: `cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src/components/RegionSection.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/RegionSection.tsx app/src/tests/components/RegionSection.test.tsx
git commit -m "feat(app): render lead photo and thumbnails in RegionSection"
```

---

### Task 5: Settings "Images" group

**Files:**

- Modify: `app/src/screens/SettingsScreen.tsx`
- Test: `app/src/tests/screens/SettingsScreen.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `app/src/tests/screens/SettingsScreen.test.tsx`, add these cases inside the existing top-level `describe('SettingsScreen', …)` block (after the last `it`):

```ts
it('shows the Images group with the photo-count stepper when images are enabled', () => {
  const { getByText } = renderSettings();
  expect(getByText('Show photos')).toBeTruthy();
  expect(getByText('Photos per region')).toBeTruthy();
});

it('hides the photo-count stepper when images are turned off', () => {
  const { getByLabelText, queryByText } = renderSettings();
  expect(queryByText('Photos per region')).toBeTruthy();
  fireEvent(getByLabelText('Show photos'), 'valueChange', false);
  expect(queryByText('Photos per region')).toBeNull();
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd app && npx jest --config jest.config.cjs src/tests/screens/SettingsScreen.test.tsx`
Expected: FAIL — no "Show photos" / "Photos per region" rows yet.

- [ ] **Step 3: Add the Images group**

In `app/src/screens/SettingsScreen.tsx`, insert a new `Group` immediately **after** the closing `</Group>` of the `label="Reading"` group and **before** the `label="Display"` group:

```tsx
<Group theme={theme} aes={aes} label="Images">
  <Row
    theme={theme}
    aes={aes}
    label="Show photos"
    sub="Lead + thumbnail on the top stories per region."
    value={
      <Switch
        value={prefs.imagesEnabled}
        onValueChange={(v) => setPref('imagesEnabled', v)}
        trackColor={{ false: theme.chip, true: theme.accent }}
        thumbColor={theme.bg}
        accessibilityLabel="Show photos"
      />
    }
  />
  {prefs.imagesEnabled && (
    <Row
      theme={theme}
      aes={aes}
      label="Photos per region"
      sub="Max stories per region that show a photo. 1 = lead only."
      value={
        <Stepper
          theme={theme}
          aes={aes}
          value={prefs.photoCount}
          min={1}
          max={3}
          icons
          onChange={(v) => setPref('photoCount', v)}
        />
      }
    />
  )}
</Group>
```

(`Switch`, `Stepper`, `Group`, `Row`, `setPref`, and `prefs` are all already imported / in scope in this file.)

- [ ] **Step 4: Run tests to confirm they pass**

Run: `cd app && npx jest --config jest.config.cjs src/tests/screens/SettingsScreen.test.tsx`
Expected: PASS (existing cases + the two new ones).

- [ ] **Step 5: Typecheck + lint**

Run: `cd app && npx tsc --noEmit && npx eslint --ext .ts,.tsx src/screens/SettingsScreen.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/screens/SettingsScreen.tsx app/src/tests/screens/SettingsScreen.test.tsx
git commit -m "feat(app): add Images settings group (toggle + photo count)"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the app package**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint the app package**

Run: `cd app && npx eslint --ext .ts,.tsx src`
Expected: no errors.

- [ ] **Step 3: Run the whole app test suite**

Run: `cd app && npm test`
Expected: all suites pass, including the new `RegionSection` suite and the extended `SettingsScreen` / `preferences` suites.

- [ ] **Step 4: Format check (root)**

Run: `npm run format:check`
Expected: passes for the files this plan touched. If it flags any of them, run `npm run format`, then `git add -A && git commit -m "style: prettier"`. (Ignore a pre-existing warning on `todo.md` — it is an unrelated uncommitted file and must not be staged.)

- [ ] **Step 5: Confirm branch state**

Run: `git status` and `git log --oneline -7`
Expected: working tree clean (apart from the pre-existing `todo.md` / webview-plan changes); Task 1–5 commits present on `feat/app-digest-images`.

---

## Self-review against the spec

- **Types (`imageUrl?`)** → Task 2 ✔ (`Headline`, `GlobalHeadline`).
- **Prefs (`imagesEnabled`/`photoCount`, defaults, auto-sync)** → Task 2 ✔ (defaults; sync is automatic via existing pipeline — no code needed, confirmed in spec §2).
- **No storage changes** → honored; Tasks touch no `storage/digests.ts` ✔.
- **Settings Images group (toggle + conditional stepper)** → Task 5 ✔ (conditional render per spec, diverging from the dimmed Global-Headlines pattern — noted).
- **expo-image** → Tasks 1 + 3 ✔.
- **Lead / thumb / text variants, graceful fallback** → Task 4 ✔ (`isLead`/`isThumb` both require `!!h.imageUrl`; else text row).
- **Source-label pill, no blur** → Task 4 ✔ (solid `rgba` pill via `pillBg`).
- **Source row = sourceName + link icon (no category)** → Task 4 ✔ (`SourceRow`).
- **Performance (recyclingKey, fixed dims)** → Task 3/4 ✔ (`recyclingKey={h.url}`, fixed `aspectRatio`/`size`).
- **Testing (RegionSection variants, settings toggle, prefs defaults)** → Tasks 2/4/5 ✔.
- **Out of scope (article reader, global section, server caching, placeholder)** → not touched ✔.

**Type/name consistency:** `imageUrl`, `imagesEnabled`, `photoCount`, `HeadlineImage` (props `uri`/`size`/`aspectRatio`/`radius`/`recyclingKey`/`testID`/`style`), test IDs `lead-image`/`thumb-image`, and the `Show photos` / `Photos per region` labels are used identically across all tasks.
