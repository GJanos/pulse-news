import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { font } from '../../themes';
import type { Theme, Aesthetic } from '../../themes';
import PulseIcon from '../../components/Icon';

interface Props {
  theme: Theme;
  aes: Aesthetic;
  onLogout: () => void;
  onDeleteAccount: () => Promise<string | null>;
}

/** Sign-out button, destructive delete-account action, and version footer. */
export function SettingsFooter({
  theme,
  aes,
  onLogout,
  onDeleteAccount,
}: Props): React.ReactElement {
  const [deleting, setDeleting] = useState(false);

  const confirmDelete = (): void => {
    Alert.alert(
      'Delete account',
      'This permanently deletes your account and all data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            onDeleteAccount().then((err) => {
              setDeleting(false);
              if (err) Alert.alert('Error', err);
            });
          },
        },
      ],
    );
  };

  return (
    <>
      <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
        <Pressable
          onPress={onLogout}
          accessibilityLabel="Sign out"
          style={({ pressed }) => [
            s.logout,
            { borderColor: theme.rule, opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <PulseIcon name="logout" size={15} color={theme.text} />
          <Text
            style={{
              fontFamily: font(aes, 'ui', 600),
              fontSize: 14.5,
              color: theme.text,
              marginLeft: 8,
            }}
          >
            Sign out
          </Text>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 12, alignItems: 'center' }}>
        <Pressable
          onPress={confirmDelete}
          disabled={deleting}
          style={({ pressed }) => ({
            opacity: deleting || pressed ? 0.55 : 1,
            paddingVertical: 10,
          })}
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#c0392b" />
          ) : (
            <Text style={{ fontFamily: font(aes, 'ui', 500), fontSize: 13, color: '#c0392b' }}>
              Delete account
            </Text>
          )}
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 16, alignItems: 'center' }}>
        <Text
          style={{
            fontFamily: font(aes, 'eyebrow', 500),
            fontSize: 10,
            letterSpacing: 2,
            lineHeight: 18,
            color: theme.textFaint,
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          Pulse News · v1.0{'\n'}one notification · one tap · move on
        </Text>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  logout: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
