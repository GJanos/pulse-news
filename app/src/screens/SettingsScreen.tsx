import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AESTHETICS, THEMES, font } from '../themes';
import { useAppStore } from '../store';
import RegionPicker from '../components/RegionPicker';
import PulseIcon from '../components/Icon';
import { AccountSection } from './settings/AccountSection';
import { NotificationSection } from './settings/NotificationSection';
import { GlobalHeadlinesSection } from './settings/GlobalHeadlinesSection';
import { ReadingSection } from './settings/ReadingSection';
import { ImagesSection } from './settings/ImagesSection';
import { StorageSection } from './settings/StorageSection';
import { DisplaySection } from './settings/DisplaySection';
import { SettingsFooter } from './settings/SettingsFooter';

interface Props {
  onLogout: () => void;
  onDeleteAccount: () => Promise<string | null>;
  embedded?: boolean;
}

/**
 * Settings shell: header + scrolling list of section cards. Only theme/aesthetic
 * are read here (a change to either restyles the whole screen, which is correct);
 * every other preference is subscribed to inside the specific section that renders
 * it, so e.g. changing the notify time re-renders only NotificationSection.
 */
export default function SettingsScreen({
  onLogout,
  onDeleteAccount,
  embedded = false,
}: Props): React.ReactElement {
  const insets = useSafeAreaInsets();
  const themeId = useAppStore((s) => s.prefs.theme);
  const aesId = useAppStore((s) => s.prefs.aesthetic);
  const setScreen = useAppStore((s) => s.setScreen);

  const theme = THEMES[themeId] ?? THEMES.light;
  const aes = AESTHETICS[aesId] ?? AESTHETICS.editorial;

  const handleBack = (): void => setScreen('digest');

  return (
    <View
      style={
        embedded
          ? // embedded inside the pager, which already lives inside App's SafeAreaView
            { flex: 1, backgroundColor: theme.bg }
          : [
              StyleSheet.absoluteFill,
              {
                backgroundColor: theme.bg,
                zIndex: 50,
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              },
            ]
      }
    >
      <View style={[s.header, { backgroundColor: theme.bg, borderBottomColor: theme.rule }]}>
        <Pressable
          onPress={handleBack}
          style={[s.backBtn, { backgroundColor: theme.chip }]}
          hitSlop={6}
          accessibilityLabel="Back"
        >
          <PulseIcon name="arrow-left" size={16} color={theme.text} />
        </Pressable>
        <Text
          style={{
            fontFamily: font(aes, 'title', 700),
            fontSize: 22,
            lineHeight: 26,
            letterSpacing: -0.3,
            color: theme.text,
            flex: 1,
            marginLeft: 8,
          }}
        >
          Settings
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <AccountSection theme={theme} aes={aes} />
        <NotificationSection theme={theme} aes={aes} />
        <GlobalHeadlinesSection theme={theme} aes={aes} />
        <RegionPicker />
        <ReadingSection theme={theme} aes={aes} />
        <ImagesSection theme={theme} aes={aes} />
        <StorageSection theme={theme} aes={aes} />
        <DisplaySection theme={theme} aes={aes} />
        <SettingsFooter
          theme={theme}
          aes={aes}
          onLogout={onLogout}
          onDeleteAccount={onDeleteAccount}
        />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
