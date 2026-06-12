import React from 'react';
import { render } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import { DigestPage } from '../../components/DigestPage';
import { useDigestPageData } from '../../hooks/useDigestPageData';
import { useTodayISO } from '../../hooks/useTodayISO';
import { useJumpTargets } from '../../hooks/useJumpTargets';

jest.mock('../../hooks/useDigestPageData');
jest.mock('../../hooks/useTodayISO');
jest.mock('../../hooks/useJumpTargets');
jest.mock('../../components/JumpModal', () => () => null);

const mockUseDigestPageData = useDigestPageData as jest.Mock;
const mockUseTodayISO = useTodayISO as jest.Mock;
const mockUseJumpTargets = useJumpTargets as jest.Mock;

const BASE_DATA = {
  digest: null,
  error: null,
  isLoading: false,
  visible: [],
  visibleGlobalHeadlines: [],
  hasGlobal: false,
  totalHeadlines: 0,
  currencyRates: {},
  forceRefresh: jest.fn(),
};

function renderPage() {
  return render(
    <DigestPage
      ref={React.createRef()}
      dayIndex={0}
      onOpenArticle={jest.fn()}
      currencyRatesEnabled={false}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseTodayISO.mockReturnValue('2026-06-12');
  mockUseJumpTargets.mockReturnValue({ listData: [], indexMapRef: { current: new Map() } });
});

it('renders an ActivityIndicator while loading', () => {
  mockUseDigestPageData.mockReturnValue({ ...BASE_DATA, isLoading: true });
  const { UNSAFE_getByType } = renderPage();
  expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
});

it('renders without crashing when there is no digest (empty state)', () => {
  mockUseDigestPageData.mockReturnValue(BASE_DATA);
  const { toJSON } = renderPage();
  expect(toJSON()).toBeTruthy();
});

it('renders without crashing when an error is set', () => {
  mockUseDigestPageData.mockReturnValue({ ...BASE_DATA, error: new Error('network') });
  const { toJSON } = renderPage();
  expect(toJSON()).toBeTruthy();
});
