import { View, ScrollView } from 'react-native';

const Reanimated = {
  View,
  ScrollView,
  createAnimatedComponent: (c: unknown) => c,
  default: {
    View,
    ScrollView,
    createAnimatedComponent: (c: unknown) => c,
  },
  useSharedValue: (v: unknown) => ({ value: v }),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  useAnimatedProps: (fn: () => unknown) => fn(),
  useAnimatedScrollHandler: () => () => undefined,
  withTiming: (v: unknown) => v,
  withSpring: (v: unknown) => v,
  cancelAnimation: () => undefined,
  interpolate: (_v: unknown, _i: number[], output: number[]) => output[0],
  Extrapolation: { CLAMP: 'clamp' },
  Easing: {
    in: (e: unknown) => e,
    out: (e: unknown) => e,
    inOut: (e: unknown) => e,
    cubic: (t: number) => t,
  },
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
};

module.exports = Reanimated;
