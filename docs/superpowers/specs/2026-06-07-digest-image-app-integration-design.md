# Digest Image App Integration — Design Spec

**Date:** 2026-06-07
**Status:** Approved (brainstorm)
**Branch:** `feat/app-digest-images`

## Goal

Surface the `imageUrl` already persisted on digest headlines in the React Native
app: render an editorial **lead photo** on story #1 and **small thumbnails** on
the next stories (up to a user-controlled count) per region, and add a Settings
**Images** group to control it. Images are intentionally sparse — their scarcity
is the signal.

## Background / reconciliation

The original design handoff (`../Pulse News Design/design_handoff_digest_images/`)
assumed Perplexity `return_images` with positional assignment, a response-level
0–2 image array, and a headline field named `image`. **That approach was replaced
before this slice.** The shipped cron extracts **og:image per headline**, stores
it as `imageUrl`, and already persists it on both region digests and global
digests (`feat/persist-digest-images`, merged to `develop`).

Consequences that simplify this slice versus the handoff:

- Every headline can carry its own image (subject to ~80% og:image coverage) —
  there is **no per-response cap** and **no positional assignment**.
- The handoff's `Math.min(photoCount, availableImages.length)` ceiling is moot.
- The field is **`imageUrl`**, not `image`.

## Decisions (locked during brainstorm)

| Decision                                     | Choice                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Missing image (lead/thumb has no `imageUrl`) | **Graceful text fallback** — render the normal text row, no placeholder.                                           |
| Image component                              | **`expo-image`** (disk+memory cache, `contentFit`, transition, `recyclingKey`).                                    |
| Article-reader hero image                    | **Out of scope** this slice (later).                                                                               |
| Global "Top News" section images             | **Out of scope** this slice (later).                                                                               |
| Source row content                           | Keep the **live app's** sourceName + link icon (no category). Handoff's right-aligned CATEGORY is deferred polish. |
| Lead image source-label pill                 | Solid translucent `rgba` pill, **no blur** (avoids an `expo-blur` dependency).                                     |

A direct consequence of "graceful text fallback": the handoff's tonal placeholder
(`PulsePhoto` — OKLCH base, `repeating-linear-gradient` hatch, `backdropFilter`
blur) is **not implemented**. Those are web-only CSS features with no clean RN
equivalent, and they are unnecessary once missing images fall back to text.

## Architecture

Three layers, smallest-diff-first:

### 1. Types (`app/src/types.ts`)

Add one optional field to the existing interfaces:

```ts
export interface Headline {
  // ...existing...
  imageUrl?: string; // og:image matched by cron; absent on old cached digests
}

export interface GlobalHeadline {
  // ...existing...
  imageUrl?: string; // forward-compat; not rendered this slice
}
```

No storage-layer changes. `app/src/storage/digests.ts` (MMKV cache) and the
Supabase `payload` fetch are JSON round-trips, so `imageUrl` flows through with
zero code changes. Legacy cached digests simply lack the field → text rows.

### 2. Preferences (`app/src/types.ts`, `app/src/storage/preferences.ts`)

Two new keys on `UserPreferences`:

| Key             | Type      | Default | Range |
| --------------- | --------- | ------- | ----- |
| `imagesEnabled` | `boolean` | `true`  | —     |
| `photoCount`    | `number`  | `2`     | 1–3   |

Added to `DEFAULT_PREFERENCES`. They persist and sync through the **existing**
prefs pipeline (`setPref` → debounced flush → `saveLocalPreferences` /
`pushRemotePreferences`); `loadLocalPreferences`/`pullRemotePreferences` already
spread over `DEFAULT_PREFERENCES`, so existing users get the defaults
automatically. **No new sync code.**

### 3. Settings UI (`app/src/screens/SettingsScreen.tsx`)

New `SettingsGroup` titled **Images**, placed between Reading and Display:

- Row **Show photos** → existing settings toggle bound to `imagesEnabled`,
  sub-label "Lead + thumbnail on the top stories per region."
- Row **Photos per region** → existing `Stepper` (`min={1} max={3}`), bound to
  `photoCount`, **conditionally rendered only when `imagesEnabled` is true**
  (conditional render, not opacity). Sub-label "Max stories per region that show
  a photo. 1 = lead only."

### 4. Digest render (`app/src/components/RegionSection.tsx` + new `HeadlineImage.tsx`)

New thin component `app/src/components/HeadlineImage.tsx` wrapping `expo-image`:
centralizes `contentFit:'cover'`, `transition`, `recyclingKey`, and `onError`
(error → report empty so the caller drops to text). Props: `uri`,
`aspectRatio?`, `size?` (square), `radius`, `recyclingKey`.

`RegionSection` resolves per-headline variant (index `i`, `pc = photoCount`):

```ts
const imagesOn = imagesEnabled !== false;
const isLead = imagesOn && i === 0 && !!h.imageUrl;
const isThumb = imagesOn && i > 0 && i < pc && !!h.imageUrl;
// else → existing text row, unchanged
```

- **Lead:** full-bleed `HeadlineImage` (`aspectRatio={3/2}`, `radius={0}`),
  source-label pill bottom-left, then the existing number + title (+3px) +
  summary + source block beneath.
- **Thumb:** existing row + a 74×74 (`radius={8}`) `HeadlineImage` to the right
  of the text block (`flexShrink:0`).
- **Text:** unchanged.

`imagesEnabled` and `photoCount` are read from the store the same way the
component already reads `theme`/`aesthetic`/`regionStyle`.

## Error handling & graceful degradation

- No `imageUrl` → text row (never an empty box or broken-image icon).
- `expo-image` load failure (`onError`) → treated as no image for that row;
  the rest of the row renders normally. (Acceptable minor reflow on late error;
  no error surfaced to the user.)
- Old cached digests → no field → text rows; refreshed digests gain photos.

## Performance

- The `FlatList` in `DigestPage` recycles at the **region-section** level, not
  per headline; each `RegionSection` owns its own `expo-image` instances keyed by
  `recyclingKey={h.url}`. Existing `removeClippedSubviews` /
  `maxToRenderPerBatch` / `windowSize` tuning is unchanged.
- Fixed `aspectRatio` / fixed thumb size means image rows have deterministic
  height — no layout thrash, no `scrollToIndex` regressions.

## Testing

Jest + ts-jest + `@testing-library/react-native` (existing app patterns):

- **RegionSection**: lead image at `i===0` when `imageUrl` present; thumb for
  `0<i<photoCount`; text row when `imageUrl` missing; text row when
  `imagesEnabled` false; `photoCount` boundaries (`1` → lead only; `3` → lead +
  two thumbs).
- **SettingsScreen**: toggling `imagesEnabled` shows/hides the stepper and calls
  `setPref('imagesEnabled', …)`; stepper calls `setPref('photoCount', …)` and
  clamps to 1–3.
- **preferences**: `loadLocalPreferences` over a legacy blob yields
  `imagesEnabled:true`, `photoCount:2`.

Mock `expo-image` in tests with a lightweight stub (no native renderer).

## Files touched

| File                                   | Change                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `app/src/types.ts`                     | `imageUrl?` on `Headline`/`GlobalHeadline`; `imagesEnabled`/`photoCount` on `UserPreferences` |
| `app/src/storage/preferences.ts`       | defaults for the two new prefs                                                                |
| `app/src/screens/SettingsScreen.tsx`   | new Images `SettingsGroup`                                                                    |
| `app/src/components/HeadlineImage.tsx` | **new** — `expo-image` wrapper                                                                |
| `app/src/components/RegionSection.tsx` | lead/thumb/text variant rendering                                                             |
| `app/package.json`                     | add `expo-image` dependency                                                                   |
| tests                                  | RegionSection, SettingsScreen, preferences                                                    |

## Out of scope (explicit)

- Article-reader hero image (`ArticleReader`/`ArticleScreen`).
- Global "Top News" section image treatment (`GlobalSection`).
- Server-side image caching/proxying of og:image CDN URLs (raw CDN URLs used
  directly; `expo-image` disk cache mitigates re-fetch).
- The handoff's tonal placeholder, frosted-blur overlay, and right-aligned
  category label.
