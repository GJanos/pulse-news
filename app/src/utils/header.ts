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
