/** Reused from the retired useSwipe hook so the close/open feel is unchanged. */
export const SWIPE_DISTANCE = 48;
export const SWIPE_VELOCITY = 0.45;

/**
 * Decide what a released article swipe should do.
 *   `close` — rightward past distance or velocity (dismiss the overlay)
 *   `open`  — leftward past distance or velocity (open the full article)
 *   `stay`  — otherwise (spring back)
 * `dx`/`vx` are the gesture's horizontal translation / velocity. Worklet so it
 * can be called directly from the gesture's `onEnd` on the UI thread.
 */
export function resolveArticleSwipe(dx: number, vx: number): 'open' | 'close' | 'stay' {
  'worklet';
  if (dx > SWIPE_DISTANCE || vx > SWIPE_VELOCITY) return 'close';
  if (dx < -SWIPE_DISTANCE || vx < -SWIPE_VELOCITY) return 'open';
  return 'stay';
}

export function resolveReaderBack(canGoBack: boolean): 'goBack' | 'close' {
  return canGoBack ? 'goBack' : 'close';
}
