import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';
import { RootScreens } from '../../App';
import { useAppStore } from '../store';
import { DEFAULT_PREFERENCES } from '../storage/preferences';
import { THEMES } from '../themes';
import type { AuthActions } from '../hooks/useSupabaseAuth';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn().mockResolvedValue(undefined),
}));

// App.tsx pulls in these pure-ESM expo packages at module load; ts-jest does not
// transform node_modules, so stub them out to keep the RootScreens import parseable.
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn().mockResolvedValue(undefined),
  preventAutoHideAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('@expo-google-fonts/source-serif-4', () => ({}));
jest.mock('@expo-google-fonts/inter', () => ({}));
jest.mock('@expo-google-fonts/jetbrains-mono', () => ({}));

// Slice 6 wired the FCM hooks into App.tsx, pulling the native notification
// boundary into this render test. Stub it out so the import stays parseable
// and registration is a no-op here.
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  requestPermission: jest.fn(),
  hasPermission: jest.fn(),
  onTokenRefresh: jest.fn(),
  onNotificationOpenedApp: jest.fn(),
  onMessage: jest.fn(),
  getInitialNotification: jest.fn(),
  AuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },
}));
jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn() }));
jest.mock('../notifications/register', () => ({
  registerForPushNotifications: jest.fn().mockResolvedValue(null),
  listenForTokenRefresh: jest.fn(() => jest.fn()),
}));
jest.mock('../notifications/fcm', () => ({
  getNotificationPermission: jest.fn().mockResolvedValue(false),
  registerNotificationHandlers: jest.fn(() => jest.fn()),
}));
jest.mock('../notifications/devices', () => ({
  linkDeviceToUser: jest.fn().mockResolvedValue(undefined),
  updateNotifyTime: jest.fn().mockResolvedValue(undefined),
}));

const HEADLINE = {
  title: 'H',
  summary: 'S',
  url: 'https://example.com/a',
};
const REGION = {
  code: 'HU',
  country: 'HU',
  region: 'Hungary',
  continent: 'Europe',
  currency: 'HUF',
};

jest.mock('../components/DigestPager', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ReactLocal = require('react');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pressable: P } = require('react-native');
  return {
    __esModule: true,
    default: (props: { onOpenArticle: (h: unknown, r: unknown) => void }) =>
      ReactLocal.createElement(P, {
        testID: 'open-article',
        onPress: () => props.onOpenArticle(HEADLINE, REGION),
      }),
  };
});

jest.mock('../screens/SettingsScreen', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../screens/ArticleScreen', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../screens/ArticleReader', () => ({
  __esModule: true,
  default: () => null,
}));

const actions = {
  signIn: jest.fn(),
  signUp: jest.fn(),
  resetPassword: jest.fn(),
  updatePassword: jest.fn(),
  signOut: jest.fn(),
  deleteAccount: jest.fn(),
} as unknown as AuthActions;

function renderRoot() {
  return render(
    <RootScreens
      appState="ready"
      screen="digest"
      theme={THEMES.light}
      isPasswordRecovery={false}
      actions={actions}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({ prefs: DEFAULT_PREFERENCES, article: null });
});

describe('RootScreens onOpenArticle', () => {
  it('opens the system browser and does not set article when openLinksIn is "browser"', () => {
    useAppStore.setState({ prefs: { ...DEFAULT_PREFERENCES, openLinksIn: 'browser' } });
    const { getByTestId } = renderRoot();
    fireEvent.press(getByTestId('open-article'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(HEADLINE.url, {
      showInRecents: false,
    });
    expect(useAppStore.getState().article).toBeNull();
  });

  it('sets the article and does not open the browser when openLinksIn is "in-app"', () => {
    useAppStore.setState({ prefs: { ...DEFAULT_PREFERENCES, openLinksIn: 'in-app' } });
    const { getByTestId } = renderRoot();
    fireEvent.press(getByTestId('open-article'));
    expect(useAppStore.getState().article).toEqual({ h: HEADLINE, r: REGION });
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
