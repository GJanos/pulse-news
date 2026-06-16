import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import RegionPicker from '../../components/RegionPicker';

jest.mock('../../storage/preferences', () => ({
  DEFAULT_PREFERENCES: {
    selectedRegions: ['Hungary', 'Ukraine', 'Russia', 'United States', 'United Kingdom'],
    headlineCount: 5,
    regionHeadlineCounts: {},
    historyDays: 7,
    notifyTime: '07:30',
    openLinksIn: 'in-app',
    regionStyle: 'flag',
    baseCurrency: 'USD',
    showCurrencyRates: false,
    showGlobalHeadlines: true,
    globalHeadlineCount: 5,
    theme: 'light',
    aesthetic: 'editorial',
    updatedAt: new Date(0).toISOString(),
  },
}));

/** Inject a fresh jest.fn() as setPref into the store and return it. */
function spySetPref(): jest.Mock {
  const mock = jest.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAppStore.setState({ setPref: mock } as any);
  return mock;
}

beforeEach(() => {
  useAppStore.setState({ prefs: DEFAULT_PREFERENCES, prefsMutationCount: 0 });
});

function renderPicker() {
  return render(<RegionPicker />);
}

describe('RegionPicker — toggle', () => {
  it('selecting an unselected region calls setPref with it added', () => {
    const setPref = spySetPref();
    const { getByLabelText } = renderPicker();
    // 'Israel' is the first region not in the default 5
    fireEvent.press(getByLabelText('Israel, not selected'));
    expect(setPref).toHaveBeenCalledWith('selectedRegions', expect.arrayContaining(['Israel']));
  });

  it('deselecting a selected region calls setPref with it removed', () => {
    const setPref = spySetPref();
    const { getByLabelText } = renderPicker();
    fireEvent.press(getByLabelText('Hungary, selected'));
    const call = (setPref as jest.Mock).mock.calls[0];
    expect(call[1]).not.toContain('Hungary');
  });

  it('cannot deselect the only remaining selected region', () => {
    useAppStore.setState({
      prefs: { ...DEFAULT_PREFERENCES, selectedRegions: ['Hungary'] },
    });
    const setPref = spySetPref();
    const { getByLabelText } = renderPicker();
    fireEvent.press(getByLabelText('Hungary, selected'));
    expect(setPref).not.toHaveBeenCalled();
  });
});

describe('RegionPicker — reorder mode', () => {
  it('move up is a no-op for the first selected region', () => {
    const mock = spySetPref();
    const { getByText, getByLabelText } = renderPicker();
    fireEvent.press(getByText('Reorder'));
    const moveUpBtn = getByLabelText('Move Hungary up');
    fireEvent.press(moveUpBtn);
    // Hungary is index 0, can't go higher — selectedRegions should not be called
    const call = mock.mock.calls.find((c) => c[0] === 'selectedRegions');
    expect(call).toBeUndefined();
  });

  it('All button selects all regions', () => {
    const { REGIONS: ALL_REGIONS } = jest.requireActual('../../data') as {
      REGIONS: { region: string }[];
    };
    const mock = spySetPref();
    const { getByText } = renderPicker();
    fireEvent.press(getByText('Reorder'));
    fireEvent.press(getByText('All'));
    const call = mock.mock.calls.find((c) => c[0] === 'selectedRegions');
    expect(call).toBeTruthy();
    expect((call![1] as string[]).length).toBe(ALL_REGIONS.length);
  });

  it('pill toggles to None when all selected and reduces to a single region', () => {
    const { REGIONS } = jest.requireActual('../../data') as { REGIONS: { region: string }[] };
    useAppStore.setState({
      prefs: { ...DEFAULT_PREFERENCES, selectedRegions: REGIONS.map((r) => r.region) },
    });
    const setPref = spySetPref();
    const { getByText, queryByText } = renderPicker();
    fireEvent.press(getByText('Reorder'));
    // When everything is selected the pill reads "None", not "All".
    expect(queryByText('All')).toBeNull();
    fireEvent.press(getByText('None'));
    const call = (setPref as jest.Mock).mock.calls.find((c) => c[0] === 'selectedRegions');
    expect(call).toBeTruthy();
    expect((call![1] as string[]).length).toBe(1); // keeps one — never empty
  });
});

describe('RegionPicker — tune mode', () => {
  it('per-region count change calls setPref with merged regionHeadlineCounts', () => {
    expect.assertions(1);
    const mock = spySetPref();
    const { getByText, getAllByRole } = renderPicker();
    fireEvent.press(getByText('Tune'));
    const buttons = getAllByRole('button');
    // The first non-headline-stepper increment button belongs to Hungary row
    // Pressing any increment button should call setPref('regionHeadlineCounts', ...)
    // Try pressing each button until we find one that triggers regionHeadlineCounts
    for (const btn of buttons) {
      fireEvent.press(btn);
      const call = mock.mock.calls.find((c) => c[0] === 'regionHeadlineCounts');
      if (call) {
        expect(typeof call[1]).toBe('object');
        return;
      }
      mock.mock.calls.length = 0; // reset for next attempt
    }
  });
});
