import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { THEMES, AESTHETICS, font } from '../themes';
import { formatRate, type CurrencyRate } from '../hooks/useCurrencyRates';
import { useAppStore } from '../store';

interface CurrencyChipProps {
  /** The region's local currency code, e.g. "HUF". */
  code: string;
  /** The user's chosen base currency the rate is quoted in, e.g. "EUR". */
  baseCurrency: string;
  rate: CurrencyRate;
}

const POSITIVE = '#27ae60';
const NEGATIVE = '#c0392b';

export interface ChangeDisplay {
  arrow: string;
  label: string;
  color: string;
}

/**
 * Maps a daily change percent to its display arrow, label and color. Moves that
 * round to 0.00% at two decimals (|pct| < 0.005) render as a flat dash with no
 * number, so negligible drift never shows as a misleading "0.00%". Null
 * (yesterday data unavailable) renders nothing.
 */
export function changeDisplay(pct: number | null, faint: string): ChangeDisplay {
  if (pct == null) return { arrow: '', label: '', color: faint };
  if (pct >= 0.005) return { arrow: '↑', label: `${pct.toFixed(2)}%`, color: POSITIVE };
  if (pct <= -0.005) return { arrow: '↓', label: `${Math.abs(pct).toFixed(2)}%`, color: NEGATIVE };
  return { arrow: '—', label: '', color: faint };
}

/**
 * Compact two-line FX readout for a region header: the rate and `base/code`
 * pair on top, a colored ↑/↓ change line below.
 */
function CurrencyChipImpl({ code, baseCurrency, rate }: CurrencyChipProps): React.ReactElement {
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const faint = useAppStore((s) => THEMES[s.prefs.theme].textFaint);
  const { arrow, label, color } = changeDisplay(rate.changePercent, faint);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={[styles.rate, { fontFamily: font(aes, 'number', 700), color: faint }]}>
          {formatRate(rate.rate)}
        </Text>
        <Text style={[styles.label, { fontFamily: font(aes, 'number', 600), color: faint }]}>
          {baseCurrency}/{code}
        </Text>
      </View>
      {arrow !== '' && (
        <Text style={[styles.change, { fontFamily: font(aes, 'number', 600), color }]}>
          {arrow}
          {label}
        </Text>
      )}
    </View>
  );
}

export const CurrencyChip = React.memo(CurrencyChipImpl);

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-start', marginTop: -3 },
  row: { flexDirection: 'row', alignItems: 'baseline' },
  rate: { fontSize: 11, lineHeight: 14 },
  label: { fontSize: 11, lineHeight: 14, letterSpacing: 0.3, marginLeft: 6 },
  change: { fontSize: 11, lineHeight: 14 },
});
