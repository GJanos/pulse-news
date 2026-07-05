import React from 'react';
import { Switch } from 'react-native';
import type { Theme, Aesthetic } from '../../themes';
import { useAppStore } from '../../store';
import Stepper from '../../components/Stepper';
import type { UserPreferences } from '../../types';
import { Group, Row, SegRow } from './primitives';

/** Reading group — history retention, summaries toggle, link target. */
export function ReadingSection({
  theme,
  aes,
}: {
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement {
  const historyDays = useAppStore((s) => s.prefs.historyDays);
  const showSummaries = useAppStore((s) => s.prefs.showSummaries);
  const openLinksIn = useAppStore((s) => s.prefs.openLinksIn);
  const setPref = useAppStore((s) => s.setPref);

  return (
    <Group theme={theme} aes={aes} label="Reading">
      <Row
        theme={theme}
        aes={aes}
        label="Local history"
        sub="Days of digests kept on this device."
        value={
          <Stepper
            theme={theme}
            aes={aes}
            value={historyDays}
            min={3}
            max={30}
            suffix="d"
            onChange={(v) => setPref('historyDays', v)}
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Show summaries"
        sub="One-line summary under each headline."
        value={
          <Switch
            value={showSummaries}
            onValueChange={(v) => setPref('showSummaries', v)}
            trackColor={{ false: theme.chip, true: theme.accent }}
            thumbColor={theme.bg}
            accessibilityLabel="Show summaries"
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Open links in"
        value={
          <SegRow<UserPreferences['openLinksIn']>
            theme={theme}
            aes={aes}
            value={openLinksIn}
            options={[
              { value: 'in-app', label: 'In-app' },
              { value: 'browser', label: 'Browser' },
            ]}
            onChange={(v) => setPref('openLinksIn', v)}
          />
        }
      />
    </Group>
  );
}
