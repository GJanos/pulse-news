import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { PressableScale } from 'react-native-pressable-scale';
import { THEMES, AESTHETICS, font } from '../themes';
import PulseIcon from './Icon';
import { HeadlineImage } from './HeadlineImage';
import { REGIONS } from '../data';
import { useAppStore } from '../store';
import type { Headline, GlobalHeadline, Region } from '../types';

const REGION_MAP = new Map(REGIONS.map((r) => [r.region, r]));

interface GlobalSectionProps {
  headlines: GlobalHeadline[];
  onOpenArticle: (h: Headline, r: Region) => void;
}

function GlobalSectionImpl({ headlines, onOpenArticle }: GlobalSectionProps): React.ReactElement {
  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const themeId = useAppStore((s) => s.prefs.theme);
  const imagesEnabled = useAppStore((s) => s.prefs.imagesEnabled);

  const pillBg = themeId === 'dark' ? 'rgba(17,17,16,0.62)' : 'rgba(255,255,255,0.64)';
  const heroShown = !!(imagesEnabled && headlines[0]?.imageUrl);

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
        <PulseIcon name="globe" size={18} color={theme.accent} strokeWidth={1.8} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text
            style={{
              fontFamily: font(aes, 'title', 600),
              fontSize: 19,
              lineHeight: 21,
              letterSpacing: -0.3,
              color: theme.accent,
            }}
          >
            Global Headlines
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
            Cross-region · most important
          </Text>
        </View>
        <Text style={{ fontFamily: font(aes, 'number'), fontSize: 11, color: theme.textFaint }}>
          {headlines.length}
        </Text>
      </View>

      {heroShown ? (
        <View style={s.heroWrap}>
          <HeadlineImage
            uri={headlines[0]!.imageUrl!}
            testID="global-hero-image"
            aspectRatio={16 / 9}
          />
          {headlines[0]?.sourceName ? (
            <View style={[s.heroPill, { backgroundColor: pillBg }]}>
              <Text
                testID="global-hero-source"
                style={{
                  fontFamily: font(aes, 'eyebrow', 500),
                  fontSize: 8.5,
                  letterSpacing: 1.2,
                  textTransform: 'uppercase',
                  color: theme.textDim,
                }}
              >
                {headlines[0].sourceName}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {headlines.map((h, i) => {
        const fallbackCode = h.region.slice(0, 2).toUpperCase();
        const region: Region = REGION_MAP.get(h.region) ?? {
          region: h.region,
          country: fallbackCode,
          code: fallbackCode,
          continent: 'Europe',
          currency: '',
          sources: [],
        };
        const headline: Headline = {
          title: h.title,
          summary: h.summary,
          detail: h.detail,
          url: h.url,
          sourceName: h.sourceName,
          imageUrl: h.imageUrl,
        };
        return (
          <PressableScale
            key={`${h.url}-${i}`}
            onPress={() => onOpenArticle(headline, region)}
            accessibilityLabel={h.title}
            activeScale={0.94}
            style={[
              s.headlineRow,
              {
                borderBottomColor: theme.rule,
                borderBottomWidth: i < headlines.length - 1 ? StyleSheet.hairlineWidth : 0,
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
              <View style={s.headlineFoot}>
                {heroShown && i === 0 ? (
                  // Source already shown as the pill on the hero above — keep it uniform, not doubled.
                  <View />
                ) : (
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
                <View style={[s.regionPill, { backgroundColor: theme.accentSoft }]}>
                  <Text
                    style={{
                      fontFamily: font(aes, 'eyebrow', 600),
                      fontSize: 9.5,
                      letterSpacing: aes.eyebrowLetter,
                      color: theme.accent,
                      textTransform: 'uppercase',
                    }}
                  >
                    {h.region}
                  </Text>
                </View>
              </View>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

export const GlobalSection = React.memo(GlobalSectionImpl);

const s = StyleSheet.create({
  regionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headlineRow: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18 },
  headlineFoot: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  container: { marginTop: 16 },
  heroWrap: { position: 'relative', width: '100%' },
  heroPill: {
    position: 'absolute',
    left: 10,
    bottom: 9,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  numberCol: { width: 32, paddingTop: 2 },
  content: { flex: 1 },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  regionPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
});
