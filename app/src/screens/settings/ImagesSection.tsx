import React from 'react';
import { Switch } from 'react-native';
import type { Theme, Aesthetic } from '../../themes';
import { useAppStore } from '../../store';
import Stepper from '../../components/Stepper';
import { Group, Row, Gated } from './primitives';

/** Images group — photo toggle + per-region photo count. */
export function ImagesSection({
  theme,
  aes,
}: {
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement {
  const imagesEnabled = useAppStore((s) => s.prefs.imagesEnabled);
  const photoCount = useAppStore((s) => s.prefs.photoCount);
  const setPref = useAppStore((s) => s.setPref);

  return (
    <Group theme={theme} aes={aes} label="Images">
      <Row
        theme={theme}
        aes={aes}
        label="Show photos"
        sub="Lead + thumbnail on the top stories per region."
        value={
          <Switch
            value={imagesEnabled}
            onValueChange={(v) => setPref('imagesEnabled', v)}
            trackColor={{ false: theme.chip, true: theme.accent }}
            thumbColor={theme.bg}
            accessibilityLabel="Show photos"
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Photos per region"
        sub={'Max stories per region that show a photo.\n1 = lead only.'}
        value={
          <Gated enabled={imagesEnabled}>
            <Stepper
              theme={theme}
              aes={aes}
              value={photoCount}
              min={1}
              max={3}
              icons
              onChange={(v) => setPref('photoCount', v)}
            />
          </Gated>
        }
      />
    </Group>
  );
}
