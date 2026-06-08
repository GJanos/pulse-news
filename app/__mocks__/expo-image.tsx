import React from 'react';

// Host-stub for tests: renders an "ExpoImage" node and passes props through
// (testID, source, etc.) so @testing-library queries can find it.
export function Image(props: Record<string, unknown>): React.ReactElement {
  return React.createElement('ExpoImage', props);
}
