import React from 'react';
import { render } from '@testing-library/react-native';
import PinnedHeaderBar from '../../components/PinnedHeaderBar';
import { THEMES, AESTHETICS } from '../../themes';

const baseProps = {
  width: 375,
  settingsPage: 1,
  theme: THEMES.light,
  aes: AESTHETICS.editorial,
  canJump: true,
  onJump: jest.fn(),
  onOpenSettings: jest.fn(),
  onHeightChange: jest.fn(),
};

describe('PinnedHeaderBar', () => {
  it('renders the brand line and controls when on a day page (scrollX 0)', () => {
    const { getByText, getByLabelText } = render(
      <PinnedHeaderBar {...baseProps} scrollX={{ value: 0 } as never} />,
    );
    expect(getByText('Pulse')).toBeTruthy();
    expect(getByText('Daily')).toBeTruthy();
    expect(getByLabelText('Settings')).toBeTruthy();
    expect(getByLabelText('Jump to region')).toBeTruthy();
  });

  it('reports its measured height via onHeightChange on layout', () => {
    const onHeightChange = jest.fn();
    const { getByText } = render(
      <PinnedHeaderBar
        {...baseProps}
        onHeightChange={onHeightChange}
        scrollX={{ value: 0 } as never}
      />,
    );
    // Fire a layout event on the bar (its container wraps the "Pulse" text).
    const bar = getByText('Pulse').parent?.parent;
    bar?.props.onLayout?.({ nativeEvent: { layout: { height: 56 } } });
    expect(onHeightChange).toHaveBeenCalledWith(56);
  });
});
