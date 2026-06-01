import React, { useEffect } from 'react';
import { Modal, Pressable, View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import PulseIcon from './Icon';
import Flag from './Flag';
import { THEMES, AESTHETICS, font } from '../themes';
import { useAppStore } from '../store';
import type { VisibleBucket } from '../hooks/useDigestPageData';

interface Props {
  open: boolean;
  onClose: () => void;
  visible: VisibleBucket[];
  hasGlobal: boolean;
  jumpTo: (name: string) => void;
}

export default function JumpModal({ open, onClose, visible, hasGlobal, jumpTo }: Props) {
  const theme = useAppStore((s) => THEMES[s.prefs.theme]);
  const aes = useAppStore((s) => AESTHETICS[s.prefs.aesthetic]);
  const regionStyle = useAppStore((s) => s.prefs.regionStyle);

  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(open ? 1 : 0, { duration: 180 });
  }, [open, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: interpolate(opacity.value, [0, 1], [16, 0]) }],
  }));

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            styles.panel,
            { backgroundColor: theme.surface, borderColor: theme.rule },
            animStyle,
          ]}
        >
          <Text
            style={{
              fontFamily: font(aes, 'eyebrow', 600),
              fontSize: 9.5,
              letterSpacing: 1.8,
              color: theme.textFaint,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Jump to
          </Text>

          {hasGlobal && (
            <Pressable
              onPress={() => {
                onClose();
                jumpTo('__global__');
              }}
              style={[
                styles.row,
                { borderTopColor: theme.rule, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
              accessibilityLabel="Jump to Global Headlines"
            >
              <PulseIcon name="globe" size={15} color={theme.accent} />
              <Text
                style={{
                  fontFamily: font(aes, 'ui', 500),
                  fontSize: 14,
                  color: theme.accent,
                  marginLeft: 10,
                }}
              >
                Global Headlines
              </Text>
            </Pressable>
          )}

          {visible.map((b) => (
            <Pressable
              key={b.region.region}
              onPress={() => {
                onClose();
                jumpTo(b.region.region);
              }}
              style={[
                styles.row,
                { borderTopColor: theme.rule, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
              accessibilityLabel={`Jump to ${b.region.region}`}
            >
              {regionStyle !== 'code' ? (
                <Flag country={b.region.country} width={22} height={16} />
              ) : (
                <View style={[styles.codePill, { backgroundColor: theme.accentSoft }]}>
                  <Text
                    style={{
                      fontFamily: font(aes, 'number', 600),
                      fontSize: 9.5,
                      color: theme.accent,
                    }}
                  >
                    {b.region.code}
                  </Text>
                </View>
              )}
              <Text
                style={{
                  fontFamily: font(aes, 'ui', 500),
                  fontSize: 14,
                  color: theme.text,
                  marginLeft: 10,
                }}
              >
                {b.region.region}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  panel: {
    width: 240,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  codePill: {
    width: 28,
    height: 18,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
