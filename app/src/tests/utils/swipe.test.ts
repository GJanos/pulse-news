import {
  resolveArticleSwipe,
  resolveReaderBack,
  shouldBlockSettingsEntry,
  SWIPE_DISTANCE,
  SWIPE_VELOCITY,
  SETTINGS_ENTRY_COOLDOWN_MS,
} from '../../utils/swipe';

describe('swipe thresholds', () => {
  it('locks in the deliberate-swipe tuning values', () => {
    // Raised from 48 / 0.45 — see the constants' doc comment before lowering.
    expect(SWIPE_DISTANCE).toBe(72);
    expect(SWIPE_VELOCITY).toBe(0.6);
  });
});

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

describe('shouldBlockSettingsEntry', () => {
  it('blocks entry within the cooldown after a day settle', () => {
    expect(shouldBlockSettingsEntry(1000, 1000 - SETTINGS_ENTRY_COOLDOWN_MS + 1)).toBe(true);
  });

  it('allows entry once the cooldown has elapsed', () => {
    expect(shouldBlockSettingsEntry(1000, 1000 - SETTINGS_ENTRY_COOLDOWN_MS)).toBe(false);
  });

  it('allows entry when no day settle has happened yet (epoch 0)', () => {
    expect(shouldBlockSettingsEntry(Date.now(), 0)).toBe(false);
  });

  it('honours a custom cooldown', () => {
    expect(shouldBlockSettingsEntry(1000, 900, 200)).toBe(true);
    expect(shouldBlockSettingsEntry(1000, 700, 200)).toBe(false);
  });
});

describe('resolveReaderBack', () => {
  it('returns goBack when canGoBack is true', () => {
    expect(resolveReaderBack(true)).toBe('goBack');
  });

  it('returns close when canGoBack is false', () => {
    expect(resolveReaderBack(false)).toBe('close');
  });
});
