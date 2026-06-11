import { useAppStore } from '../store';
import { openExternalUrl } from './openExternalUrl';

/**
 * Opens a full article link respecting the user's `openLinksIn` preference:
 * in-app → the ArticleReader overlay (mounted at App root on `readerUrl`),
 * browser → the system browser. Used by taps that should skip the
 * ArticleScreen summary overlay, e.g. the source name on a digest row.
 */
export function openArticleUrl(url: string): void {
  const { prefs, setReaderUrl } = useAppStore.getState();
  if (prefs.openLinksIn === 'in-app') {
    setReaderUrl(url);
  } else {
    openExternalUrl(url, { showInRecents: false });
  }
}
