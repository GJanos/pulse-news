import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

interface GestureExclusionNativeModule {
  setEdgeExclusion(enabled: boolean): void;
}

/**
 * Toggle left/right edge gesture-exclusion rects on the current Android
 * activity. No-op on iOS and (handled natively) below API 29. The native
 * module is resolved lazily and any resolution failure degrades to a no-op.
 */
export function setEdgeExclusion(enabled: boolean): void {
  if (Platform.OS !== 'android') return;
  let nativeModule: GestureExclusionNativeModule;
  try {
    nativeModule = requireNativeModule('GestureExclusion') as GestureExclusionNativeModule;
  } catch {
    return;
  }
  nativeModule.setEdgeExclusion(enabled);
}
