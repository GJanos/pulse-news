import { renderHook } from '@testing-library/react-native';
import { useRef } from 'react';
import { useAppStore } from '../../store';
import { useDigestRefreshOnNonce } from '../../components/DigestPager';
import type { DigestPageHandle } from '../../components/DigestPage';

beforeEach(() => {
  useAppStore.setState({ digestRefreshNonce: 0 });
});

it('does not refresh on initial mount', () => {
  const forceRefresh = jest.fn();
  renderHook(() => {
    const ref = useRef<DigestPageHandle | null>({ forceRefresh, openJumpModal: jest.fn() });
    useDigestRefreshOnNonce(ref);
  });
  expect(forceRefresh).not.toHaveBeenCalled();
});

it('refreshes the active page when the nonce increments', () => {
  const forceRefresh = jest.fn();
  const ref = { current: { forceRefresh, openJumpModal: jest.fn() } as DigestPageHandle };
  const { rerender } = renderHook(() => useDigestRefreshOnNonce(ref));
  useAppStore.setState({ digestRefreshNonce: 1 });
  rerender({});
  expect(forceRefresh).toHaveBeenCalledTimes(1);
});
