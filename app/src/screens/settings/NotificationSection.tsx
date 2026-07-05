import React from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { font } from '../../themes';
import type { Theme, Aesthetic } from '../../themes';
import { useAppStore } from '../../store';
import PulseIcon from '../../components/Icon';
import { Group, Row, settingsStyles } from './primitives';
import { NotifyTimePicker } from './NotifyTimePicker';

/** Notification group — OS-permission banner + daily digest time picker. */
export function NotificationSection({
  theme,
  aes,
}: {
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement {
  const notifyTime = useAppStore((s) => s.prefs.notifyTime);
  const notificationsEnabled = useAppStore((s) => s.notificationsEnabled);
  const setPref = useAppStore((s) => s.setPref);

  return (
    <Group theme={theme} aes={aes} label="Notification">
      {!notificationsEnabled && (
        <Pressable
          onPress={() => void Linking.openSettings()}
          style={[settingsStyles.row, { borderBottomColor: theme.rule }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font(aes, 'ui', 500), fontSize: 14.5, color: theme.accent }}>
              Notifications disabled
            </Text>
            <Text
              style={{
                fontFamily: font(aes, 'body'),
                fontSize: 12,
                color: theme.textFaint,
                marginTop: 2,
              }}
            >
              Tap to open system settings
            </Text>
          </View>
          <PulseIcon name="arrow-right" size={16} color={theme.textFaint} />
        </Pressable>
      )}
      <Row
        theme={theme}
        aes={aes}
        label="Daily digest time"
        sub="One push a day, no more."
        value={
          <NotifyTimePicker
            theme={theme}
            aes={aes}
            value={notifyTime}
            onChange={(v) => setPref('notifyTime', v)}
          />
        }
      />
    </Group>
  );
}
