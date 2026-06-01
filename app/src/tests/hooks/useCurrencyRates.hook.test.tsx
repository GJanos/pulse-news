import React, { type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCurrencyRates } from '../../hooks/useCurrencyRates';

jest.mock('../../logger', () => ({
  getLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => jest.clearAllMocks());

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useCurrencyRates (hook)', () => {
  it('returns empty rates and skips fetching when disabled', () => {
    const { result } = renderHook(() => useCurrencyRates(['EUR'], false, 'USD'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.rates).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not leak cached rates when later disabled (viewing an older digest)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ date: '2026-06-01', usd: { eur: 0.9 } }),
    });
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCurrencyRates(['EUR'], enabled, 'USD'),
      { wrapper: makeWrapper(), initialProps: { enabled: true } },
    );

    await waitFor(() => expect(result.current.rates['EUR']).toBeDefined());

    rerender({ enabled: false });
    expect(result.current.rates).toEqual({});
  });
});
