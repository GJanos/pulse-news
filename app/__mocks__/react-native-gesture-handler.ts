import type React from 'react';
import { View, ScrollView as RNScrollView } from 'react-native';

export const GestureHandlerRootView = View;
export const ScrollView = RNScrollView;
export const GestureDetector = ({ children }: { children: React.ReactNode }) => children;

/** Chainable no-op gesture builder — every config/handler method returns itself. */
function chainable() {
  const g: Record<string, (this: unknown) => unknown> = {};
  for (const method of [
    'activeOffsetX',
    'failOffsetY',
    'numberOfTaps',
    'averageTouches',
    'onBegin',
    'onStart',
    'onUpdate',
    'onEnd',
    'onFinalize',
  ]) {
    g[method] = function (this: unknown) {
      return this;
    };
  }
  return g;
}

export const Gesture = {
  Pan: chainable,
  Pinch: chainable,
  Tap: chainable,
  Simultaneous: (...gestures: unknown[]) => gestures,
  Exclusive: (...gestures: unknown[]) => gestures,
};
