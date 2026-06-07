import React from 'react';
import { render } from '@testing-library/react-native';
import { RegionSection } from '../../components/RegionSection';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import type { Headline, Region, UserPreferences } from '../../types';

const region: Region = {
  region: 'Hungary',
  country: 'HU',
  code: 'HU',
  continent: 'Europe',
  currency: 'HUF',
  sources: [],
};

const h = (n: number, withImage: boolean): Headline => ({
  title: `Headline ${n}`,
  summary: `Summary ${n}`,
  url: `https://example.com/${n}`,
  ...(withImage ? { imageUrl: `https://img.example.com/${n}.jpg` } : {}),
});

function setPrefs(over: Partial<UserPreferences>): void {
  useAppStore.setState({
    prefs: {
      ...DEFAULT_PREFERENCES,
      theme: 'light',
      aesthetic: 'editorial',
      regionStyle: 'flag',
      baseCurrency: 'USD',
      imagesEnabled: true,
      photoCount: 2,
      ...over,
    },
  });
}

function renderSection(items: Headline[]) {
  return render(<RegionSection bucket={{ region, items }} onOpenArticle={jest.fn()} />);
}

beforeEach(() => setPrefs({}));

describe('RegionSection image treatment', () => {
  it('renders a lead image on story #1 when it has imageUrl', () => {
    const { getByTestId, queryAllByTestId } = renderSection([h(1, true), h(2, false)]);
    expect(getByTestId('lead-image')).toBeTruthy();
    expect(queryAllByTestId('thumb-image')).toHaveLength(0);
  });

  it('renders a thumbnail on story #2 within photoCount when it has imageUrl', () => {
    const { getByTestId } = renderSection([h(1, true), h(2, true)]);
    expect(getByTestId('lead-image')).toBeTruthy();
    expect(getByTestId('thumb-image')).toBeTruthy();
  });

  it('falls back to a text row (no lead image) when story #1 has no imageUrl', () => {
    const { queryByTestId, getByText } = renderSection([h(1, false), h(2, false)]);
    expect(queryByTestId('lead-image')).toBeNull();
    expect(getByText('Headline 1')).toBeTruthy();
  });

  it('shows only the lead when photoCount = 1, even if #2 has an image', () => {
    setPrefs({ photoCount: 1 });
    const { getByTestId, queryAllByTestId } = renderSection([h(1, true), h(2, true)]);
    expect(getByTestId('lead-image')).toBeTruthy();
    expect(queryAllByTestId('thumb-image')).toHaveLength(0);
  });

  it('renders no images when imagesEnabled is false', () => {
    setPrefs({ imagesEnabled: false });
    const { queryByTestId } = renderSection([h(1, true), h(2, true)]);
    expect(queryByTestId('lead-image')).toBeNull();
    expect(queryByTestId('thumb-image')).toBeNull();
  });

  it('does not thumbnail a story at/after photoCount', () => {
    setPrefs({ photoCount: 2 });
    const { queryAllByTestId } = renderSection([h(1, true), h(2, true), h(3, true)]);
    // #1 lead, #2 thumb, #3 beyond range → exactly one thumb.
    expect(queryAllByTestId('thumb-image')).toHaveLength(1);
  });
});
