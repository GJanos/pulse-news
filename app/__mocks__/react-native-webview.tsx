import React from 'react';
import { View } from 'react-native';
import type { WebViewProps, WebViewNavigation } from 'react-native-webview';

type MockRef = { goBack: jest.Mock };
interface MockInstance {
  props: WebViewProps;
  ref: MockRef | null;
}

let _last: MockInstance | null = null;

export function getMockWebView(): MockInstance {
  if (!_last) throw new Error('No WebView mounted');
  return _last;
}

export function simulateLoad(): void {
  _last?.props.onLoadEnd?.({ nativeEvent: {} } as never);
}

export function simulateError(): void {
  _last?.props.onError?.({ nativeEvent: { description: 'net::ERR_FAILED' } } as never);
}

export function simulateNavState(state: Partial<WebViewNavigation>): void {
  const full: WebViewNavigation = {
    url: 'https://example.com',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    navigationType: 'other',
    lockIdentifier: 0,
    ...state,
  };
  _last?.props.onNavigationStateChange?.(full);
}

const WebView = React.forwardRef<MockRef, WebViewProps>((props, ref) => {
  const mockRef: MockRef = { goBack: jest.fn() };
  React.useImperativeHandle(ref, () => mockRef);
  _last = { props, ref: mockRef };
  const onLoadStart = React.useRef(props.onLoadStart);
  React.useEffect(() => {
    onLoadStart.current?.({ nativeEvent: {} } as never);
  }, []);
  return <View testID="mock-webview" />;
});

WebView.displayName = 'MockWebView';

export { WebView };
export default WebView;
