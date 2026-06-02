import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PressableScale } from 'react-native-pressable-scale';
import { THEMES, AESTHETICS, font } from '../themes';
import PulseIcon from './Icon';
import Flag from './Flag';
import { CurrencyChip } from './CurrencyChip';
import type { CurrencyRate } from '../hooks/useCurrencyRates';
import { useAppStore } from '../store';
import type { Headline, Region } from '../types';
import type { VisibleBucket } from '../hooks/useDigestPageData';

interface RegionSectionProps {
  bucket: VisibleBucket;
  currencyRate?: CurrencyRate;
  onOpenArticle: (h: Headline, r: Region) => void;
}

function RegionSectionImpl({
  bucket,
  currencyRate,
  onOpenArticle,
}: RegionSectionProps): React.ReactElement {
  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const baseCurrency = useAppStore((s) => s.prefs.baseCurrency);
  const regionStyle = useAppStore((s) => s.prefs.regionStyle);
  const showFlags = regionStyle !== 'code';

  return (
    <View style={s.container}>
      <View
        style={[
          s.regionHeader,
          {
            borderTopColor: theme.accent,
            borderTopWidth: 2,
            borderBottomColor: theme.ruleStrong,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        {showFlags ? (
          <Flag country={bucket.region.country} width={26} height={20} />
        ) : (
          <View style={[s.codePill, { backgroundColor: theme.accentSoft }]}>
            <Text
              style={{
                fontFamily: font(aes, 'number', 600),
                fontSize: 11,
                color: theme.accent,
                letterSpacing: 0.4,
              }}
            >
              {bucket.region.code}
            </Text>
          </View>
        )}
        <View style={s.headerTitle}>
          <Text
            style={{
              fontFamily: font(aes, 'title', 600),
              fontSize: 19,
              lineHeight: 21,
              letterSpacing: -0.3,
              color: theme.accent,
            }}
          >
            {bucket.region.region}
          </Text>
          <Text
            style={{
              fontFamily: font(aes, 'eyebrow', 500),
              fontSize: 9,
              letterSpacing: 1.3,
              color: theme.textFaint,
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            {bucket.region.continent}
          </Text>
        </View>
        {currencyRate && (
          <CurrencyChip
            code={bucket.region.currency}
            baseCurrency={baseCurrency}
            rate={currencyRate}
          />
        )}
      </View>

      {bucket.items.map((h, i) => (
        <PressableScale
          key={`${h.url}-${i}`}
          onPress={() => onOpenArticle(h, bucket.region)}
          accessibilityLabel={h.title}
          activeScale={0.94}
          style={[
            s.headlineRow,
            {
              borderBottomColor: theme.rule,
              borderBottomWidth: i < bucket.items.length - 1 ? StyleSheet.hairlineWidth : 0,
            },
          ]}
        >
          <View style={s.numberCol}>
            <Text
              style={{
                fontFamily: font(aes, 'number', 500),
                fontSize: aes.numberSize,
                lineHeight: 16,
                color: theme.textFaint,
                letterSpacing: 0.2,
              }}
            >
              {i + 1}
            </Text>
          </View>
          <View style={s.content}>
            <Text
              style={{
                fontFamily: font(aes, 'title', aes.roles.title.weight),
                fontSize: aes.titleSize,
                lineHeight: aes.titleLh,
                letterSpacing: aes.titleLetter,
                color: theme.text,
              }}
            >
              {h.title}
            </Text>
            <Text
              style={{
                fontFamily: font(aes, 'body'),
                fontSize: aes.bodySize,
                lineHeight: aes.bodyLh,
                color: theme.textDim,
                marginTop: 8,
              }}
            >
              {h.summary}
            </Text>
            {h.sourceName && (
              <View style={s.sourceRow}>
                <Text
                  style={{
                    fontFamily: font(aes, 'ui', 600),
                    fontSize: 12,
                    color: theme.accent,
                    letterSpacing: -0.05,
                  }}
                >
                  {h.sourceName}
                </Text>
                <PulseIcon name="link" size={11} color={theme.accent} strokeWidth={1.8} />
              </View>
            )}
          </View>
        </PressableScale>
      ))}
    </View>
  );
}

export const RegionSection = React.memo(RegionSectionImpl);

const s = StyleSheet.create({
  container: { marginTop: 16 },
  regionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headerTitle: { flex: 1, marginLeft: 10 },
  codePill: {
    width: 36,
    height: 22,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -3,
  },
  headlineRow: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  numberCol: { width: 32, paddingTop: 2 },
  content: { flex: 1 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 5 },
});
