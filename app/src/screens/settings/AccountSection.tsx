import React from 'react';
import { Text } from 'react-native';
import { font } from '../../themes';
import type { Theme, Aesthetic } from '../../themes';
import { useAppStore } from '../../store';
import { Group, Row } from './primitives';

/** Account group — read-only display of the signed-in email. */
export function AccountSection({
  theme,
  aes,
}: {
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement {
  const email = useAppStore((s) => s.session?.user?.email ?? '');
  return (
    <Group theme={theme} aes={aes} label="Account">
      <Row
        theme={theme}
        aes={aes}
        label="Signed in as"
        value={
          <Text style={{ fontFamily: font(aes, 'number'), color: theme.textDim, fontSize: 13 }}>
            {email}
          </Text>
        }
      />
    </Group>
  );
}
