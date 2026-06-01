export const Linking = {
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  openSettings: jest.fn().mockResolvedValue(undefined),
  openURL: jest.fn().mockResolvedValue(undefined),
};

export const Alert = {
  alert: jest.fn(),
};

// Minimal Animated mock
interface AnimatedValue {
  _value: number;
  setValue: jest.Mock;
  addListener: jest.Mock;
  removeListener: jest.Mock;
  interpolate: jest.Mock;
}

const animatedValue = (): AnimatedValue => {
  const val: AnimatedValue = {
    _value: 0,
    setValue: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    interpolate: jest.fn(() => val),
  };
  return val;
};

const timingMock = jest.fn(() => ({
  start: jest.fn((cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true })),
}));
const springMock = jest.fn(() => ({
  start: jest.fn((cb?: (result: { finished: boolean }) => void) => cb?.({ finished: true })),
}));

export const Animated = {
  Value: jest.fn().mockImplementation(animatedValue),
  timing: timingMock,
  spring: springMock,
  sequence: jest.fn(() => ({ start: jest.fn() })),
  parallel: jest.fn(() => ({ start: jest.fn() })),
  View: 'Animated.View',
  Text: 'Animated.Text',
  ScrollView: 'Animated.ScrollView',
  createAnimatedComponent: jest.fn((comp: unknown) => comp),
  event: jest.fn(),
};

export const Easing = {
  out: jest.fn((fn: (t: number) => number) => fn),
  in: jest.fn((fn: (t: number) => number) => fn),
  cubic: jest.fn((t: number) => t),
  linear: jest.fn((t: number) => t),
  ease: jest.fn((t: number) => t),
  bezier: jest.fn(() => jest.fn((t: number) => t)),
};

export const PanResponder = {
  create: jest.fn(() => ({
    panHandlers: {
      onStartShouldSetResponder: jest.fn(),
      onMoveShouldSetResponder: jest.fn(),
      onResponderGrant: jest.fn(),
      onResponderMove: jest.fn(),
      onResponderRelease: jest.fn(),
      onResponderTerminate: jest.fn(),
      onResponderTerminationRequest: jest.fn(),
    },
  })),
};

export const Switch = 'Switch';
export const Modal = 'Modal';
export const TextInput = 'TextInput';
export const Image = 'Image';
export const SafeAreaView = 'SafeAreaView';
export const ActivityIndicator = 'ActivityIndicator';

export const AppState = {
  addEventListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
};

export const BackHandler = {
  addEventListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  removeEventListener: jest.fn(),
};

// Minimal host-component stubs for component tests
export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const TouchableOpacity = 'TouchableOpacity';
export const ScrollView = 'ScrollView';
export const FlatList = 'FlatList';
export const StyleSheet = {
  create: (styles: Record<string, unknown>) => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
};

export const LayoutAnimation = {
  configureNext: jest.fn(),
  create: jest.fn(),
  Types: { spring: 'spring', linear: 'linear', easeInEaseOut: 'easeInEaseOut' },
  Properties: { opacity: 'opacity', scaleXY: 'scaleXY' },
};
export const Platform = {
  OS: 'android',
  select: (obj: Record<string, unknown>) => obj.android ?? obj.default,
};
export const Dimensions = { get: () => ({ width: 375, height: 812 }) };
