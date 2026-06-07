import React from 'react';
import type { StyleProp } from 'react-native';
import { Image, type ImageStyle } from 'expo-image';

interface HeadlineImageProps {
  uri: string;
  /** Square edge length in px (thumbnail). Mutually exclusive with aspectRatio. */
  size?: number;
  /** Width:height ratio for a full-width image (e.g. 3 / 2). Ignored when size is set. */
  aspectRatio?: number;
  radius?: number;
  /** Stable key so expo-image recycles correctly inside the digest list. */
  recyclingKey?: string;
  testID?: string;
  style?: StyleProp<ImageStyle>;
}

/** Thin expo-image wrapper. Full-width (aspectRatio) for leads, fixed square for thumbs. */
export function HeadlineImage({
  uri,
  size,
  aspectRatio = 3 / 2,
  radius = 0,
  recyclingKey,
  testID,
  style,
}: HeadlineImageProps): React.ReactElement {
  const dims: ImageStyle =
    size !== undefined ? { width: size, height: size } : { width: '100%', aspectRatio };
  return (
    <Image
      testID={testID}
      source={{ uri }}
      recyclingKey={recyclingKey}
      contentFit="cover"
      transition={200}
      style={[dims, { borderRadius: radius }, style]}
    />
  );
}
