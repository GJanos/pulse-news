import { renderHook, act } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useTodayISO } from '../../hooks/useTodayISO';
import * as data from '../../data';

type AppStateHandler = (state: string) => void;

describe('useTodayISO', () => {
  let handler: AppStateHandler | null;
  let remove: jest.Mock;

  beforeEach(() => {
    handler = null;
    remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      handler = fn as AppStateHandler;
      return { remove } as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the current date on mount', () => {
    jest.spyOn(data, 'getTodayISO').mockReturnValue('2026-06-11');
    const { result } = renderHook(() => useTodayISO());
    expect(result.current).toBe('2026-06-11');
  });

  it('rolls over to the new date when the app foregrounds past midnight', () => {
    const spy = jest.spyOn(data, 'getTodayISO').mockReturnValue('2026-06-11');
    const { result } = renderHook(() => useTodayISO());
    expect(result.current).toBe('2026-06-11');

    spy.mockReturnValue('2026-06-12');
    act(() => handler!('active'));
    expect(result.current).toBe('2026-06-12');
  });

  it('ignores non-active transitions', () => {
    const spy = jest.spyOn(data, 'getTodayISO').mockReturnValue('2026-06-11');
    const { result } = renderHook(() => useTodayISO());

    spy.mockReturnValue('2026-06-12');
    act(() => handler!('background'));
    expect(result.current).toBe('2026-06-11');
  });

  it('keeps the same state object when the date has not changed', () => {
    jest.spyOn(data, 'getTodayISO').mockReturnValue('2026-06-11');
    const { result } = renderHook(() => useTodayISO());
    act(() => handler!('active'));
    expect(result.current).toBe('2026-06-11');
  });

  it('unsubscribes on unmount', () => {
    jest.spyOn(data, 'getTodayISO').mockReturnValue('2026-06-11');
    const { unmount } = renderHook(() => useTodayISO());
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});
