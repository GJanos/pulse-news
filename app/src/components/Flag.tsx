import React, { useState } from 'react';
import { Image, Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

interface FlagProps {
  /** ISO 3166-1 alpha-2 country code, e.g. "US". Falls back to `code`. */
  country?: string;
  /** Fallback code shown in the chip when the image fails to load. */
  code?: string;
  width?: number;
  height?: number;
  rounded?: boolean;
  /** Used when the row is in a disabled / unselected state. */
  dim?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Cross-platform country flag. Uses flagcdn.com PNGs (RN's <Image> won't
 * render SVGs directly, and Android has no built-in flag-emoji glyphs). Falls
 * back to a neutral chip with the 2-letter code if the image errors out.
 */
export default function Flag({
  country,
  code,
  width = 24,
  height = 18,
  rounded = true,
  dim = false,
  style,
}: FlagProps): React.ReactElement {
  const validateCode = (value?: string): string => {
    const candidate = (value ?? '').trim().toLowerCase();
    return /^[a-z]{2}$/.test(candidate) ? candidate : '';
  };

  const cc = validateCode(country) || validateCode(code);
  const [failed, setFailed] = useState<boolean>(false);

  const base: ViewStyle = {
    width,
    height,
    borderRadius: rounded ? 3 : 0,
    overflow: 'hidden',
    opacity: dim ? 0.45 : 1,
  };

  if (failed || !cc) {
    return (
      <View style={[base, styles.fallback, style]}>
        <Text style={[styles.fallbackText, { fontSize: Math.round(height * 0.55) }]}>
          {(cc || '').toUpperCase()}
        </Text>
      </View>
    );
  }

  // flagcdn buckets: w20/40/80/160/320/640. Pick smallest >= 2× render width.
  const target = width * 2;
  const buckets = [20, 40, 80, 160, 320, 640];
  const bucket = buckets.find((b) => b >= target) ?? 640;

  return (
    <View style={[base, style]}>
      <Image
        source={{ uri: `https://flagcdn.com/w${bucket}/${cc}.png` }}
        accessibilityLabel={cc.toUpperCase()}
        onError={() => setFailed(true)}
        style={{ width, height, resizeMode: 'cover' }}
      />
      <View pointerEvents="none" style={[styles.hairline, { borderRadius: rounded ? 3 : 0 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    fontFamily: 'JetBrainsMono_600SemiBold',
    color: 'rgba(0,0,0,0.55)',
    letterSpacing: 0.4,
  },
  hairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
});
