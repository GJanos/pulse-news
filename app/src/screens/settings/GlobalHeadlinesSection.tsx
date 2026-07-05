import React from 'react';
import { Switch } from 'react-native';
import type { Theme, Aesthetic } from '../../themes';
import { useAppStore } from '../../store';
import Stepper from '../../components/Stepper';
import { globalHeadlineMax } from '../../config';
import { Group, Row, Gated } from './primitives';

/** Global headlines group — toggle + count stepper. */
export function GlobalHeadlinesSection({
  theme,
  aes,
}: {
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement {
  const showGlobalHeadlines = useAppStore((s) => s.prefs.showGlobalHeadlines);
  const globalHeadlineCount = useAppStore((s) => s.prefs.globalHeadlineCount);
  const setPref = useAppStore((s) => s.setPref);

  return (
    <Group theme={theme} aes={aes} label="Global Headlines">
      <Row
        theme={theme}
        aes={aes}
        label="Show global headlines"
        sub="Top stories from across all regions, selected by global importance."
        value={
          <Switch
            value={showGlobalHeadlines}
            onValueChange={(v) => setPref('showGlobalHeadlines', v)}
            trackColor={{ false: theme.chip, true: theme.accent }}
            thumbColor={theme.bg}
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Count"
        sub="Number of global headlines shown."
        value={
          <Gated enabled={showGlobalHeadlines}>
            <Stepper
              theme={theme}
              aes={aes}
              value={globalHeadlineCount}
              min={1}
              max={globalHeadlineMax}
              icons
              onChange={(v) => setPref('globalHeadlineCount', v)}
            />
          </Gated>
        }
      />
    </Group>
  );
}
