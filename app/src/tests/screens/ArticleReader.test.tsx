import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import ArticleReader from '../../screens/ArticleReader';
import {
  simulateLoad,
  simulateError,
  simulateNavState,
} from '../../../__mocks__/react-native-webview';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../modules/gesture-exclusion', () => ({
  setEdgeExclusion: jest.fn(),
}));

const url = 'https://example.com/full-article';

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    prefs: { ...DEFAULT_PREFERENCES, theme: 'light', aesthetic: 'editorial' },
  });
});

function renderReader(onClose = jest.fn()) {
  return render(<ArticleReader url={url} onClose={onClose} />);
}

describe('ArticleReader', () => {
  it('shows a loading spinner before load completes', () => {
    const { getByTestId } = renderReader();
    expect(getByTestId('reader-loading')).toBeTruthy();
  });

  it('hides the loading spinner after onLoadEnd fires', () => {
    const { queryByTestId } = renderReader();
    act(() => simulateLoad());
    expect(queryByTestId('reader-loading')).toBeNull();
  });

  it('renders the WebView', () => {
    const { getByTestId } = renderReader();
    expect(getByTestId('mock-webview')).toBeTruthy();
  });

  it('shows the source hostname in the top bar', () => {
    const { getByText } = renderReader();
    expect(getByText('example.com')).toBeTruthy();
  });

  it('renders the error overlay with Retry after onError', () => {
    const { getByTestId, queryByTestId } = renderReader();
    act(() => simulateError());
    expect(queryByTestId('reader-loading')).toBeNull();
    expect(getByTestId('reader-error')).toBeTruthy();
    expect(getByTestId('reader-retry')).toBeTruthy();
  });

  it('updates readerCanGoBack in the store via onNavigationStateChange', () => {
    renderReader();
    act(() => simulateNavState({ canGoBack: true }));
    expect(useAppStore.getState().readerCanGoBack).toBe(true);
  });

  it('registers readerBackFn in the store on mount', () => {
    renderReader();
    expect(useAppStore.getState().readerBackFn).not.toBeNull();
  });

  it('clears readerBackFn in the store on unmount', () => {
    const { unmount } = renderReader();
    unmount();
    expect(useAppStore.getState().readerBackFn).toBeNull();
  });

  it('has a Close reader button', () => {
    const { getByLabelText } = renderReader();
    expect(getByLabelText('Close reader')).toBeTruthy();
  });

  it('has an Open in browser button in the top bar', () => {
    const { getByLabelText } = renderReader();
    expect(getByLabelText('Open in browser')).toBeTruthy();
  });
});
