import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import SettingsScreen from '../../screens/SettingsScreen';

jest.mock('../../storage/preferences', () => ({
  DEFAULT_PREFERENCES: {
    selectedRegions: ['Hungary'],
    headlineCount: 5,
    regionHeadlineCounts: {},
    historyDays: 7,
    notifyTime: '07:30',
    openLinksIn: 'in-app',
    regionStyle: 'flag',
    imagesEnabled: true,
    photoCount: 2,
    baseCurrency: 'USD',
    showCurrencyRates: false,
    showGlobalHeadlines: true,
    globalHeadlineCount: 5,
    theme: 'light',
    aesthetic: 'editorial',
    updatedAt: new Date(0).toISOString(),
  },
}));

// RegionPicker has its own tests; mock it out to keep SettingsScreen tests focused
jest.mock('../../components/RegionPicker', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: () => React.createElement(View, { testID: 'region-picker' }),
  };
});

const defaultProps = {
  onLogout: jest.fn(),
  onDeleteAccount: jest.fn().mockResolvedValue(null),
};

beforeEach(() => {
  jest.clearAllMocks();
  useAppStore.setState({
    prefs: DEFAULT_PREFERENCES,
    prefsMutationCount: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session: { user: { id: 'u1', email: 'test@pulse.com' } } as any,
    notificationsEnabled: true,
  });
});

function renderSettings(props = defaultProps) {
  return render(<SettingsScreen {...props} />);
}

describe('SettingsScreen', () => {
  it('calls onLogout when sign out is pressed', () => {
    const onLogout = jest.fn();
    const { getByLabelText } = renderSettings({ ...defaultProps, onLogout });
    fireEvent.press(getByLabelText('Sign out'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('shows an Alert when delete account is pressed', () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const { getByText } = renderSettings();
    fireEvent.press(getByText('Delete account'));
    expect(alertSpy).toHaveBeenCalledWith('Delete account', expect.any(String), expect.any(Array));
  });

  it('calls onDeleteAccount after confirming the alert', async () => {
    const onDeleteAccount = jest.fn().mockResolvedValue(null);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = renderSettings({ ...defaultProps, onDeleteAccount });
    fireEvent.press(getByText('Delete account'));
    await waitFor(() => expect(onDeleteAccount).toHaveBeenCalledTimes(1));
  });

  it('does NOT call onDeleteAccount when alert is cancelled', () => {
    const onDeleteAccount = jest.fn();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cancelBtn = buttons?.find((b: any) => b.style === 'cancel');
      cancelBtn?.onPress?.();
    });
    const { getByText } = renderSettings({ ...defaultProps, onDeleteAccount });
    fireEvent.press(getByText('Delete account'));
    expect(onDeleteAccount).not.toHaveBeenCalled();
  });

  it('shows error alert when onDeleteAccount resolves with error string', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    const onDeleteAccount = jest.fn().mockResolvedValue('Something went wrong');
    jest.spyOn(Alert, 'alert').mockImplementationOnce((_title, _msg, buttons) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleteBtn = buttons?.find((b: any) => b.style === 'destructive');
      deleteBtn?.onPress?.();
    });
    const { getByText } = renderSettings({ ...defaultProps, onDeleteAccount });
    fireEvent.press(getByText('Delete account'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Error', 'Something went wrong');
    });
  });

  it('shows notifications disabled banner when notificationsEnabled is false', () => {
    useAppStore.setState({ notificationsEnabled: false });
    const { getByText } = renderSettings();
    expect(getByText('Notifications disabled')).toBeTruthy();
  });

  it('does not show notifications disabled banner when enabled', () => {
    useAppStore.setState({ notificationsEnabled: true });
    const { queryByText } = renderSettings();
    expect(queryByText('Notifications disabled')).toBeNull();
  });

  it('shows the Images group with the photo-count stepper when images are enabled', () => {
    const { getByText } = renderSettings();
    expect(getByText('Show photos')).toBeTruthy();
    expect(getByText('Photos per region')).toBeTruthy();
  });

  it('hides the photo-count stepper when images are turned off', () => {
    const { getByLabelText, queryByText } = renderSettings();
    expect(queryByText('Photos per region')).toBeTruthy();
    fireEvent(getByLabelText('Show photos'), 'valueChange', false);
    expect(queryByText('Photos per region')).toBeNull();
  });
});
