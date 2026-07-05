import React from 'react';
import { Switch } from 'react-native';
import type { Theme, Aesthetic } from '../../themes';
import { useAppStore } from '../../store';
import type { UserPreferences } from '../../types';
import { Group, Row, SegRow } from './primitives';
import { CurrencyPicker } from './CurrencyPicker';

/** Display group — theme, font, region label, currency rates + base currency. */
export function DisplaySection({
  theme,
  aes,
}: {
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement {
  const themeId = useAppStore((s) => s.prefs.theme);
  const aesId = useAppStore((s) => s.prefs.aesthetic);
  const regionStyle = useAppStore((s) => s.prefs.regionStyle);
  const showCurrencyRates = useAppStore((s) => s.prefs.showCurrencyRates);
  const baseCurrency = useAppStore((s) => s.prefs.baseCurrency);
  const setPref = useAppStore((s) => s.setPref);

  return (
    <Group theme={theme} aes={aes} label="Display">
      <Row
        theme={theme}
        aes={aes}
        label="Theme"
        value={
          <SegRow<UserPreferences['theme']>
            theme={theme}
            aes={aes}
            value={themeId}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'sepia', label: 'Sepia' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(v) => setPref('theme', v)}
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Font"
        value={
          <SegRow<UserPreferences['aesthetic']>
            theme={theme}
            aes={aes}
            value={aesId}
            options={[
              { value: 'editorial', label: 'Serif' },
              { value: 'clinical', label: 'Sans' },
              { value: 'brutalist', label: 'Mono' },
            ]}
            onChange={(v) => setPref('aesthetic', v)}
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Region label"
        value={
          <SegRow<UserPreferences['regionStyle']>
            theme={theme}
            aes={aes}
            value={regionStyle}
            options={[
              { value: 'flag', label: 'Flag' },
              { value: 'code', label: 'Code' },
            ]}
            onChange={(v) => setPref('regionStyle', v)}
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Currency rates"
        sub="Show rate and daily % change per region."
        value={
          <Switch
            value={showCurrencyRates}
            onValueChange={(v) => setPref('showCurrencyRates', v)}
            trackColor={{ false: theme.chip, true: theme.accent }}
            thumbColor={theme.bg}
          />
        }
      />
      <Row
        theme={theme}
        aes={aes}
        label="Base currency"
        sub="Rates displayed relative to this currency."
        value={
          <CurrencyPicker
            theme={theme}
            aes={aes}
            value={baseCurrency}
            onChange={(v) => setPref('baseCurrency', v)}
            disabled={!showCurrencyRates}
          />
        }
      />
    </Group>
  );
}
