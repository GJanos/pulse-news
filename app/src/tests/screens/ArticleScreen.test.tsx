import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import ArticleScreen from '../../screens/ArticleScreen';
import type { Headline, Region } from '../../types';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../modules/gesture-exclusion', () => ({
  setEdgeExclusion: jest.fn(),
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn().mockResolvedValue(undefined),
}));

const headline: Headline = {
  title: 'Test headline',
  summary: 'A summary.',
  url: 'https://www.example.com/news/story',
  category: 'Politics',
  sourceName: 'Example Times',
};

const region: Region = {
  code: 'HU',
  country: 'HU',
  region: 'Hungary',
  continent: 'Europe',
  currency: 'HUF',
} as Region;

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    prefs: { ...DEFAULT_PREFERENCES, theme: 'light', aesthetic: 'editorial' },
  });
});

function renderArticle(h: Headline = headline, r: Region = region) {
  return render(<ArticleScreen headline={h} region={r} onClose={jest.fn()} />);
}

describe('ArticleScreen', () => {
  it('renders hostname with leading www stripped', () => {
    const { getByText } = renderArticle();
    expect(getByText('example.com')).toBeTruthy();
  });

  it('falls back to the raw url when it cannot be parsed', () => {
    const { getByText } = renderArticle({ ...headline, url: 'not a valid url' });
    expect(getByText('not a valid url')).toBeTruthy();
  });

  it('opens the browser with no options when Read full article is pressed', () => {
    const { getByLabelText } = renderArticle();
    fireEvent.press(getByLabelText('Read full article'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(headline.url);
  });

  it('copies the url and toggles the copied state, then resets', async () => {
    jest.useFakeTimers();
    const { getByLabelText } = renderArticle();
    fireEvent.press(getByLabelText('Copy link'));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(headline.url);
    await act(async () => {});
    expect(getByLabelText('Link copied')).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(getByLabelText('Copy link')).toBeTruthy();
    jest.useRealTimers();
  });

  it('shows the category chip only when category is set', () => {
    const { queryByText, rerender } = renderArticle();
    expect(queryByText('Politics')).toBeTruthy();
    rerender(
      <ArticleScreen
        headline={{ ...headline, category: undefined }}
        region={region}
        onClose={jest.fn()}
      />,
    );
    expect(queryByText('Politics')).toBeNull();
  });

  it('shows the detail paragraph only when detail is set', () => {
    const { queryByText, rerender } = renderArticle();
    expect(queryByText('Deep dive text')).toBeNull();
    rerender(
      <ArticleScreen
        headline={{ ...headline, detail: 'Deep dive text' }}
        region={region}
        onClose={jest.fn()}
      />,
    );
    expect(queryByText('Deep dive text')).toBeTruthy();
  });
});
