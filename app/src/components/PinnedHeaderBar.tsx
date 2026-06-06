import React from 'react';
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useAnimatedProps,
  type SharedValue,
} from 'react-native-reanimated';
import PulseMark from './PulseMark';
import PulseIcon from './Icon';
import { font, type Theme, type Aesthetic } from '../themes';
import { headerOpacityForScrollX, HEADER_FADE_EPSILON } from '../utils/header';

interface Props {
  scrollX: SharedValue<number>;
  settingsPage: number;
  width: number;
  theme: Theme;
  aes: Aesthetic;
  canJump: boolean;
  onJump: () => void;
  onOpenSettings: () => void;
  onHeightChange: (h: number) => void;
}

const iconBtn = {
  width: 36,
  height: 36,
  borderRadius: 10,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

/**
 * The unchanging brand/controls line, rendered once and layered over the pager.
 * Stays visually pinned across day↔day swipes and fades out over the final
 * `today → settings` segment so the settings page is headerless. Reports its
 * measured height so the pager can pad day pages to clear it.
 */
export default function PinnedHeaderBar({
  scrollX,
  settingsPage,
  width,
  theme,
  aes,
  canJump,
  onJump,
  onOpenSettings,
  onHeightChange,
}: Props): React.ReactElement {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: headerOpacityForScrollX(scrollX.value, settingsPage, width),
  }));

  const animatedProps = useAnimatedProps(() => {
    const o = headerOpacityForScrollX(scrollX.value, settingsPage, width);
    return { pointerEvents: (o < HEADER_FADE_EPSILON ? 'none' : 'auto') as 'none' | 'auto' };
  });

  return (
    <Animated.View
      style={[styles.bar, { backgroundColor: theme.bg }, animatedStyle]}
      animatedProps={animatedProps}
      onLayout={(e: LayoutChangeEvent) => onHeightChange(e.nativeEvent.layout.height)}
    >
      <View style={styles.wordmark}>
        <PulseMark size={22} color={theme.text} accent={theme.accent} />
        <Text
          style={{
            fontFamily: font(aes, 'title', 700),
            fontSize: 22,
            lineHeight: 22,
            letterSpacing: -0.4,
            color: theme.text,
            marginLeft: 8,
          }}
        >
          Pulse
        </Text>
        <Text
          style={{
            fontFamily: font(aes, 'eyebrow', 600),
            fontSize: 9,
            lineHeight: 10,
            letterSpacing: 1.6,
            color: theme.accent,
            marginLeft: 8,
            textTransform: 'uppercase',
          }}
        >
          Daily
        </Text>
      </View>
      <View style={{ flexDirection: 'row' }}>
        {canJump && (
          <Pressable
            onPress={onJump}
            style={iconBtn}
            hitSlop={6}
            accessibilityLabel="Jump to region"
          >
            <PulseIcon name="list-ul" size={18} color={theme.textDim} />
          </Pressable>
        )}
        <Pressable
          onPress={onOpenSettings}
          style={iconBtn}
          hitSlop={6}
          accessibilityLabel="Settings"
        >
          <PulseIcon name="settings" size={18} color={theme.textDim} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  wordmark: { flexDirection: 'row', alignItems: 'center' },
});
