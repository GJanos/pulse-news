import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PressableScale } from 'react-native-pressable-scale';
import { THEMES, AESTHETICS, font } from '../themes';
import type { Theme, Aesthetic } from '../themes';
import PulseIcon from './Icon';
import Flag from './Flag';
import { CurrencyChip } from './CurrencyChip';
import { HeadlineImage } from './HeadlineImage';
import type { CurrencyRate } from '../hooks/useCurrencyRates';
import { useAppStore } from '../store';
import type { Headline, Region } from '../types';
import type { VisibleBucket } from '../hooks/useDigestPageData';

interface RegionSectionProps {
  bucket: VisibleBucket;
  currencyRate?: CurrencyRate;
  onOpenArticle: (h: Headline, r: Region) => void;
}

function HeadlineFoot({
  h,
  theme,
  aes,
}: {
  h: Headline;
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement | null {
  if (!h.sourceName && !h.category) return null;
  return (
    <View style={s.headlineFoot}>
      {h.sourceName ? (
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
      ) : null}
      {h.category ? (
        <Text
          style={{
            fontFamily: font(aes, 'eyebrow', 600),
            fontSize: 9.5,
            letterSpacing: aes.eyebrowLetter,
            color: theme.textFaint,
            textTransform: 'uppercase',
          }}
        >
          {h.category}
        </Text>
      ) : null}
    </View>
  );
}

function RegionSectionImpl({
  bucket,
  currencyRate,
  onOpenArticle,
}: RegionSectionProps): React.ReactElement {
  const theme = useAppStore((st) => THEMES[st.prefs.theme]);
  const aes = useAppStore((st) => AESTHETICS[st.prefs.aesthetic]);
  const themeId = useAppStore((st) => st.prefs.theme);
  const baseCurrency = useAppStore((st) => st.prefs.baseCurrency);
  const regionStyle = useAppStore((st) => st.prefs.regionStyle);
  const imagesEnabled = useAppStore((st) => st.prefs.imagesEnabled);
  const photoCount = useAppStore((st) => st.prefs.photoCount);
  const showFlags = regionStyle !== 'code';
  const imagesOn = imagesEnabled !== false;
  const pillBg = themeId === 'dark' ? 'rgba(17,17,16,0.62)' : 'rgba(255,255,255,0.64)';

  const numberStyle = {
    fontFamily: font(aes, 'number', 500),
    fontSize: aes.numberSize,
    lineHeight: 16,
    color: theme.textFaint,
    letterSpacing: 0.2,
  };
  const summaryStyle = {
    fontFamily: font(aes, 'body'),
    fontSize: aes.bodySize,
    lineHeight: aes.bodyLh,
    color: theme.textDim,
    marginTop: 8,
  };

  // Pre-compute which stories get image treatment. Uses count-based logic so later
  // stories with images fill slots that earlier image-less stories leave empty.
  const imageVariants: Array<'lead' | 'thumb' | 'text'> = bucket.items.map(() => 'text');
  if (imagesOn) {
    let slots = photoCount;
    bucket.items.forEach((h, i) => {
      if (slots > 0 && h.imageUrl) {
        imageVariants[i] = i === 0 ? 'lead' : 'thumb';
        slots--;
      }
    });
  }

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

      {bucket.items.map((h, i) => {
        const hasBorder = i < bucket.items.length - 1;
        const borderStyle = {
          borderBottomColor: theme.rule,
          borderBottomWidth: hasBorder ? StyleSheet.hairlineWidth : 0,
        };
        const variant = imageVariants[i] ?? 'text';
        const isLead = variant === 'lead';
        const isThumb = variant === 'thumb';

        if (isLead) {
          return (
            <PressableScale
              key={`${h.url}-${i}`}
              onPress={() => onOpenArticle(h, bucket.region)}
              accessibilityLabel={h.title}
              activeScale={0.94}
              style={[s.leadRow, borderStyle]}
            >
              <View style={s.leadImageWrap}>
                <HeadlineImage
                  uri={h.imageUrl!}
                  aspectRatio={3 / 2}
                  radius={0}
                  recyclingKey={h.url}
                  testID="lead-image"
                />
                {h.sourceName ? (
                  <View style={[s.leadPill, { backgroundColor: pillBg }]}>
                    <Text
                      style={{
                        fontFamily: font(aes, 'eyebrow', 500),
                        fontSize: 8.5,
                        letterSpacing: 1.2,
                        textTransform: 'uppercase',
                        color: theme.textDim,
                      }}
                    >
                      {h.sourceName}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={s.leadBody}>
                <View style={s.numberCol}>
                  <Text style={numberStyle}>{i + 1}</Text>
                </View>
                <View style={s.content}>
                  <Text
                    style={{
                      fontFamily: font(aes, 'title', aes.roles.title.weight),
                      fontSize: aes.titleSize + 3,
                      lineHeight: aes.titleLh + 3,
                      letterSpacing: aes.titleLetter,
                      color: theme.text,
                    }}
                  >
                    {h.title}
                  </Text>
                  <Text style={summaryStyle}>{h.summary}</Text>
                  <HeadlineFoot h={h} theme={theme} aes={aes} />
                </View>
              </View>
            </PressableScale>
          );
        }

        return (
          <PressableScale
            key={`${h.url}-${i}`}
            onPress={() => onOpenArticle(h, bucket.region)}
            accessibilityLabel={h.title}
            activeScale={0.94}
            style={[s.headlineRow, borderStyle]}
          >
            <View style={s.numberCol}>
              <Text style={numberStyle}>{i + 1}</Text>
            </View>
            <View style={s.content}>
              <View style={s.rowBody}>
                <View style={s.textBlock}>
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
                  <Text style={summaryStyle}>{h.summary}</Text>
                </View>
                {isThumb ? (
                  <HeadlineImage
                    uri={h.imageUrl!}
                    size={74}
                    radius={8}
                    recyclingKey={h.url}
                    testID="thumb-image"
                    style={s.thumb}
                  />
                ) : null}
              </View>
              <HeadlineFoot h={h} theme={theme} aes={aes} />
            </View>
          </PressableScale>
        );
      })}
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
  leadRow: { paddingBottom: 18 },
  leadImageWrap: { position: 'relative', width: '100%' },
  leadPill: {
    position: 'absolute',
    left: 10,
    bottom: 9,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  leadBody: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 14 },
  numberCol: { width: 32, paddingTop: 2 },
  content: { flex: 1 },
  rowBody: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  textBlock: { flex: 1, minWidth: 0 },
  thumb: { marginTop: 2 },
  headlineFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
