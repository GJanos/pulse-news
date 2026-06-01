import type { StateCreator } from 'zustand';
import { storage } from '../../storage/mmkv';
import { getLogger } from '../../logger';
import { config } from '../../config';
import type { ScreenId, ArticleEntry } from '../../types';

const log = getLogger('nav');

export const NAV_KEY = '@pulse/nav_state';
export const NAV_TTL_MS = config.screenStateTtlMs;

const VALID_SCREENS = new Set<string>([
  'splash',
  'digest',
  'settings',
  'login',
] satisfies ScreenId[]);

interface PersistedNav {
  screen: ScreenId;
  dayIndex: number;
  article: ArticleEntry | null;
  savedAt: number;
}

export interface NavSlice {
  screen: ScreenId;
  dayIndex: number;
  article: ArticleEntry | null;
  digestRefreshNonce: number;
  setScreen: (screen: ScreenId) => void;
  setDayIndex: (idx: number) => void;
  setArticle: (entry: ArticleEntry | null) => void;
  navigateToDigest: () => void;
  restoreNavState: () => void;
  persistNavState: () => void;
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null;

export const createNavSlice: StateCreator<NavSlice> = (set, get) => ({
  screen: 'digest',
  dayIndex: 0,
  article: null,
  digestRefreshNonce: 0,

  setScreen: (screen) => {
    set({ screen });
    get().persistNavState();
  },

  setDayIndex: (dayIndex) => {
    set({ dayIndex });
    get().persistNavState();
  },

  setArticle: (article) => {
    set({ article });
    // Article is transient — not persisted across restarts
  },

  navigateToDigest: () => {
    set({ screen: 'digest', dayIndex: 0, digestRefreshNonce: get().digestRefreshNonce + 1 });
    get().persistNavState();
  },

  restoreNavState: () => {
    try {
      const raw = storage.getString(NAV_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersistedNav;
      const age = Date.now() - saved.savedAt;
      if (age >= NAV_TTL_MS) {
        log.debug(`nav TTL expired (${Math.round(age / 60_000)} min) — starting fresh`);
        storage.remove(NAV_KEY);
        return;
      }
      if (!VALID_SCREENS.has(saved.screen)) {
        log.warn(`unknown persisted screen '${saved.screen}' — starting fresh`);
        storage.remove(NAV_KEY);
        return;
      }
      const safeScreen: ScreenId =
        saved.screen === 'splash' || saved.screen === 'login'
          ? 'digest'
          : (saved.screen as ScreenId);
      set({ screen: safeScreen, dayIndex: saved.dayIndex ?? 0, article: saved.article ?? null });
      log.debug(`restored nav: screen=${safeScreen} dayIndex=${saved.dayIndex}`);
    } catch {
      log.warn('corrupted nav state — starting fresh');
    }
  },

  persistNavState: () => {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      try {
        const { screen, dayIndex, article } = get();
        if (screen === 'splash' || screen === 'login') return;
        storage.set(NAV_KEY, JSON.stringify({ screen, dayIndex, article, savedAt: Date.now() }));
      } catch (e: unknown) {
        log.warn(`failed to persist nav state: ${String(e)}`);
      } finally {
        _persistTimer = null;
      }
    }, 700);
    _persistTimer.unref?.();
  },
});
