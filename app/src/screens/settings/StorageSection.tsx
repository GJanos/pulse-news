import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, Alert } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { font } from '../../themes';
import type { Theme, Aesthetic } from '../../themes';
import { Group, Row } from './primitives';

/** Storage group — clear the downloaded-image disk/memory cache. */
export function StorageSection({
  theme,
  aes,
}: {
  theme: Theme;
  aes: Aesthetic;
}): React.ReactElement {
  const [cacheCleared, setCacheCleared] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearing = useRef(false);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const clearImageCache = (): void => {
    if (clearing.current) return;
    clearing.current = true;
    Promise.all([ExpoImage.clearDiskCache(), ExpoImage.clearMemoryCache()])
      .then(() => {
        setCacheCleared(true);
        if (clearTimer.current) clearTimeout(clearTimer.current);
        clearTimer.current = setTimeout(() => setCacheCleared(false), 2000);
      })
      .catch(() => {
        Alert.alert('Could not clear cache', 'Please try again.');
      })
      .finally(() => {
        clearing.current = false;
      });
  };

  return (
    <Group theme={theme} aes={aes} label="Storage">
      <Row
        theme={theme}
        aes={aes}
        label="Clear image cache"
        sub={
          'Frees downloaded article photos — the bulk of app storage.\nPhotos re-download as you read.'
        }
        value={
          <Pressable
            onPress={clearImageCache}
            accessibilityLabel={cacheCleared ? 'Image cache cleared' : 'Clear image cache'}
            style={({ pressed }) => ({
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              backgroundColor: theme.chip,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              style={{
                fontFamily: font(aes, 'ui', 600),
                fontSize: 12.5,
                color: cacheCleared ? theme.accent : theme.text,
              }}
            >
              {cacheCleared ? 'Cleared' : 'Clear'}
            </Text>
          </Pressable>
        }
      />
    </Group>
  );
}
