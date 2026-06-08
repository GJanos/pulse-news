import type React from 'react';
import { View, ScrollView as RNScrollView } from 'react-native';

export const GestureHandlerRootView = View;
export const ScrollView = RNScrollView;
export const GestureDetector = ({ children }: { children: React.ReactNode }) => children;
export const Gesture = {
  Pan: () => ({
    activeOffsetX: function (this: unknown) {
      return this;
    },
    failOffsetY: function (this: unknown) {
      return this;
    },
    onBegin: function (this: unknown) {
      return this;
    },
    onStart: function (this: unknown) {
      return this;
    },
    onUpdate: function (this: unknown) {
      return this;
    },
    onEnd: function (this: unknown) {
      return this;
    },
    onFinalize: function (this: unknown) {
      return this;
    },
  }),
};
