import React, { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  clamp,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import PulseIcon from './Icon';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

interface Props {
  /** Image to show; null hides the modal. */
  uri: string | null;
  onClose: () => void;
}

/**
 * Full-screen image viewer: pinch to zoom (1–4×), pan while zoomed,
 * double-tap to toggle 1× ↔ 2.5×. Close via the ✕ button or hardware back.
 */
export function ImageViewerModal({ uri, onClose }: Props): React.ReactElement {
  const { width: W, height: H } = useWindowDimensions();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Fresh image → start un-zoomed.
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [uri, scale, savedScale, tx, ty, savedTx, savedTy]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, MIN_SCALE, MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      if (scale.value <= MIN_SCALE) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((e) => {
      if (savedScale.value <= MIN_SCALE) return;
      // Keep the image edge from drifting further than half the overflow.
      const maxX = (W * (scale.value - 1)) / 2;
      const maxY = (H * (scale.value - 1)) / 2;
      tx.value = clamp(savedTx.value + e.translationX, -maxX, maxX);
      ty.value = clamp(savedTy.value + e.translationY, -maxY, maxY);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const zoomed = scale.value > MIN_SCALE;
      const next = zoomed ? MIN_SCALE : DOUBLE_TAP_SCALE;
      scale.value = withTiming(next, { duration: 180 });
      savedScale.value = next;
      if (zoomed) {
        tx.value = withTiming(0, { duration: 180 });
        ty.value = withTiming(0, { duration: 180 });
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });

  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[s.imageWrap, animatedStyle]}>
            {uri ? (
              <Image
                source={{ uri }}
                contentFit="contain"
                style={{ width: W, height: H }}
                testID="image-viewer-image"
              />
            ) : null}
          </Animated.View>
        </GestureDetector>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityLabel="Close image"
          style={s.closeBtn}
          testID="image-viewer-close"
        >
          <PulseIcon name="close" size={18} color="#fff" strokeWidth={2} />
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: { alignItems: 'center', justifyContent: 'center' },
  closeBtn: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
