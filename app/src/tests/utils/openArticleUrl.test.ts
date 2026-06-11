import { useAppStore } from '../../store';
import { openArticleUrl } from '../../utils/openArticleUrl';
import * as ext from '../../utils/openExternalUrl';

describe('openArticleUrl', () => {
  const setReaderUrl = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ext, 'openExternalUrl').mockImplementation(() => {});
    useAppStore.setState({ setReaderUrl });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens the in-app reader when openLinksIn is in-app', () => {
    useAppStore.setState((s) => ({ prefs: { ...s.prefs, openLinksIn: 'in-app' } }));
    openArticleUrl('https://example.com/article');
    expect(setReaderUrl).toHaveBeenCalledWith('https://example.com/article');
    expect(ext.openExternalUrl).not.toHaveBeenCalled();
  });

  it('opens the system browser when openLinksIn is browser', () => {
    useAppStore.setState((s) => ({ prefs: { ...s.prefs, openLinksIn: 'browser' } }));
    openArticleUrl('https://example.com/article');
    expect(ext.openExternalUrl).toHaveBeenCalledWith('https://example.com/article', {
      showInRecents: false,
    });
    expect(setReaderUrl).not.toHaveBeenCalled();
  });
});
