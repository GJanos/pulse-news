import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, BackHandler, Platform } from 'react-native';
import { NavigationBar } from 'expo-navigation-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  SourceSerif4_400Regular,
  SourceSerif4_500Medium,
  SourceSerif4_600SemiBold,
  SourceSerif4_700Bold,
} from '@expo-google-fonts/source-serif-4';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_600SemiBold,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { THEMES, AESTHETICS } from './src/themes';
import { useAppStore } from './src/store';
import { useAppInit } from './src/hooks/useAppInit';
import { useAuthInit } from './src/hooks/useAuthInit';
import { usePreferences } from './src/hooks/usePreferences';
import { useDeviceRegistration } from './src/hooks/useDeviceRegistration';
import { useNotificationHandlers } from './src/hooks/useNotificationHandlers';
import { useNotificationClearing } from './src/hooks/useNotificationClearing';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import SplashScreenComponent from './src/screens/SplashScreen';
import LoginScreen from './src/screens/LoginScreen';
import ResetPasswordScreen from './src/screens/ResetPasswordScreen';
import DigestPager from './src/components/DigestPager';
import SettingsScreen from './src/screens/SettingsScreen';
import ArticleScreen from './src/screens/ArticleScreen';
import ArticleReader from './src/screens/ArticleReader';
import { resolveReaderBack } from './src/utils/swipe';
import { openExternalUrl } from './src/utils/openExternalUrl';
import { getLogger } from './src/logger';
import UpdateRequiredScreen from './src/screens/stubs/UpdateRequiredScreen';
import MaintenanceScreen from './src/screens/stubs/MaintenanceScreen';
import type { AppState, ScreenId, Headline, Region } from './src/types';
import type { Theme } from './src/themes';
import type { AuthActions } from './src/hooks/useSupabaseAuth';
import type { DigestPageHandle } from './src/components/DigestPage';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
const log = getLogger('App');
const defaultAes = AESTHETICS.editorial;

export default function App(): React.ReactElement {
  const [fontsLoaded, fontError] = useFonts({
    SourceSerif4_400Regular,
    SourceSerif4_500Medium,
    SourceSerif4_600SemiBold,
    SourceSerif4_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });

  useAppInit(fontsLoaded || !!fontError);

  const appState = useAppStore((s) => s.appState);
  const screen = useAppStore((s) => s.screen);
  const isPasswordRecovery = useAppStore((s) => s.isPasswordRecovery);
  const themeId = useAppStore((s) => s.prefs.theme);
  const theme = THEMES[themeId] ?? THEMES.dark;

  const actions = useAuthInit();
  usePreferences();
  useDeviceRegistration();
  useNotificationHandlers();
  useNotificationClearing();

  useEffect(() => {
    if (appState !== 'booting') {
      void SplashScreen.hideAsync();
    }
  }, [appState]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setHidden(true);
  }, []);

  return (
    <GestureHandlerRootView style={s.root}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <RootScreens
              appState={appState}
              screen={screen}
              theme={theme}
              isPasswordRecovery={isPasswordRecovery}
              actions={actions}
            />
            <StatusBar style={theme.barStyle} />
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

interface RootScreensProps {
  appState: AppState;
  screen: ScreenId;
  theme: Theme;
  isPasswordRecovery: boolean;
  actions: AuthActions;
}

export function RootScreens({
  appState,
  screen,
  theme,
  isPasswordRecovery,
  actions,
}: RootScreensProps): React.ReactElement {
  const dayIndex = useAppStore((s) => s.dayIndex);
  const setDayIndex = useAppStore((s) => s.setDayIndex);
  const article = useAppStore((s) => s.article);
  const setArticle = useAppStore((s) => s.setArticle);
  const setScreen = useAppStore((s) => s.setScreen);
  const readerUrl = useAppStore((s) => s.readerUrl);
  const setReaderUrl = useAppStore((s) => s.setReaderUrl);
  const activePageRef = useRef<DigestPageHandle | null>(null);

  const onOpenArticle = useCallback(
    (h: Headline, r: Region) => {
      const openLinksIn = useAppStore.getState().prefs.openLinksIn;
      if (openLinksIn === 'browser') {
        log.debug(`opening article in browser: ${h.url}`);
        openExternalUrl(h.url, { showInRecents: false });
      } else {
        setArticle({ h, r });
      }
    },
    [setArticle],
  );

  const settingsSlot = useMemo(
    () => (
      <SettingsScreen
        embedded
        onLogout={() => {
          void actions.signOut();
        }}
        onDeleteAccount={actions.deleteAccount}
      />
    ),
    [actions.deleteAccount, actions.signOut],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const state = useAppStore.getState();
      if (state.readerUrl) {
        const action = resolveReaderBack(state.readerCanGoBack);
        if (action === 'goBack') {
          state.readerBackFn?.();
        } else {
          state.setReaderUrl(null);
        }
        return true;
      }
      if (article) {
        setArticle(null);
        return true;
      }
      if (screen === 'settings') {
        setScreen('digest');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [article, screen, setArticle, setScreen]);

  if (isPasswordRecovery) {
    return (
      <ResetPasswordScreen
        theme={theme}
        aes={defaultAes}
        onUpdatePassword={actions.updatePassword}
      />
    );
  }

  if (appState === 'booting') return <View style={[s.root, { backgroundColor: theme.bg }]} />;

  if (appState === 'auth-check' || appState === 'prefs-loading') {
    return <SplashScreenComponent theme={theme} aes={defaultAes} />;
  }

  if (appState === 'unauthenticated') {
    return (
      <LoginScreen
        theme={theme}
        aes={defaultAes}
        onSignIn={actions.signIn}
        onSignUp={actions.signUp}
        onResetPassword={actions.resetPassword}
      />
    );
  }

  if (appState === 'update-required') return <UpdateRequiredScreen />;
  if (appState === 'maintenance') return <MaintenanceScreen />;

  // appState === 'ready'
  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[s.root, { backgroundColor: theme.bg }]}
    >
      {(screen === 'digest' || screen === 'settings') && (
        <DigestPager
          dayIndex={dayIndex}
          setDayIndex={setDayIndex}
          settingsSlot={settingsSlot}
          onOpenArticle={onOpenArticle}
          activePageRef={activePageRef}
        />
      )}
      {article && (
        <ArticleScreen headline={article.h} region={article.r} onClose={() => setArticle(null)} />
      )}
      {readerUrl && <ArticleReader url={readerUrl} onClose={() => setReaderUrl(null)} />}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
});
