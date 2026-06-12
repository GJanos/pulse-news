/**
 * Global swipe tuning. Raised from the original 48px / 0.45 after field use:
 * small drags during scrolling kept triggering article open/close, and
 * overshooting flings landed in settings. Bump these to make every swipe
 * more deliberate; lower them to make the UI more eager.
 */
export const SWIPE_DISTANCE = 72;
export const SWIPE_VELOCITY = 0.6;

/**
 * Horizontal dead zones before a pan gesture activates at all (px).
 * `ARTICLE` applies to the article overlay's full-surface pan; `READER_EDGE`
 * to the in-app reader's left-edge strip.
 */
export const ARTICLE_ACTIVE_OFFSET_X = 22;
export const READER_EDGE_ACTIVE_OFFSET_X = 8;

/**
 * Min ms the pager must rest on a day page before a swipe may settle on the
 * settings page. Absorbs the overshooting fling of a fast day→day→today
 * swipe-run that otherwise sails past today into settings. The header
 * settings button is unaffected — it navigates through the store directly.
 */
export const SETTINGS_ENTRY_COOLDOWN_MS = 600;

export function shouldBlockSettingsEntry(
  nowMs: number,
  lastDaySettleAtMs: number,
  cooldownMs: number = SETTINGS_ENTRY_COOLDOWN_MS,
): boolean {
  const elapsed = nowMs - lastDaySettleAtMs;
  // A backward clock jump makes elapsed negative; treat the cooldown as
  // expired rather than blocking until the clock catches back up.
  return elapsed >= 0 && elapsed < cooldownMs;
}

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
