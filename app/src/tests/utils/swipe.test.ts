import { resolveArticleSwipe, SWIPE_DISTANCE, SWIPE_VELOCITY } from '../../utils/swipe';

describe('resolveArticleSwipe', () => {
  it('closes on a rightward drag past the distance threshold', () => {
    expect(resolveArticleSwipe(SWIPE_DISTANCE + 1, 0)).toBe('close');
  });

  it('closes on a fast rightward fling past the velocity threshold', () => {
    expect(resolveArticleSwipe(10, SWIPE_VELOCITY + 0.1)).toBe('close');
  });

  it('opens on a leftward drag past the distance threshold', () => {
    expect(resolveArticleSwipe(-(SWIPE_DISTANCE + 1), 0)).toBe('open');
  });

  it('opens on a fast leftward fling past the velocity threshold', () => {
    expect(resolveArticleSwipe(-10, -(SWIPE_VELOCITY + 0.1))).toBe('open');
  });

  it('stays for a neutral / sub-threshold gesture', () => {
    expect(resolveArticleSwipe(0, 0)).toBe('stay');
    expect(resolveArticleSwipe(SWIPE_DISTANCE, SWIPE_VELOCITY)).toBe('stay'); // boundary is exclusive
    expect(resolveArticleSwipe(-SWIPE_DISTANCE, -SWIPE_VELOCITY)).toBe('stay');
  });
});
