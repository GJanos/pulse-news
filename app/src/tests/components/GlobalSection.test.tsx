import React from 'react';
import { render } from '@testing-library/react-native';
import { GlobalSection } from '../../components/GlobalSection';
import { useAppStore } from '../../store';
import { DEFAULT_PREFERENCES } from '../../storage/preferences';
import type { GlobalHeadline } from '../../types';

const gh = (n: number, imageUrl?: string): GlobalHeadline => ({
  title: `Global ${n}`,
  summary: `Summary ${n}`,
  url: `https://example.com/${n}`,
  sourceName: 'Test Source',
  region: 'TestRegion',
  imageUrl,
});

function setPrefs(imagesEnabled: boolean): void {
  useAppStore.setState({
    prefs: { ...DEFAULT_PREFERENCES, theme: 'light', aesthetic: 'editorial', imagesEnabled },
  });
}

beforeEach(() => setPrefs(true));

describe('GlobalSection hero image', () => {
  it('renders hero image for headline #1 when imageUrl set and imagesEnabled', () => {
    const { getByTestId } = render(
      <GlobalSection
        headlines={[gh(1, 'https://img.example.com/1.jpg'), gh(2)]}
        onOpenArticle={jest.fn()}
      />,
    );
    expect(getByTestId('global-hero-image')).toBeTruthy();
  });

  it('does not render hero image when imagesEnabled is false', () => {
    setPrefs(false);
    const { queryByTestId } = render(
      <GlobalSection
        headlines={[gh(1, 'https://img.example.com/1.jpg'), gh(2)]}
        onOpenArticle={jest.fn()}
      />,
    );
    expect(queryByTestId('global-hero-image')).toBeNull();
  });

  it('does not render hero image when headline #1 has no imageUrl', () => {
    const { queryByTestId } = render(
      <GlobalSection headlines={[gh(1), gh(2)]} onOpenArticle={jest.fn()} />,
    );
    expect(queryByTestId('global-hero-image')).toBeNull();
  });

  it('renders exactly one hero image even when multiple headlines have imageUrl', () => {
    const { queryAllByTestId } = render(
      <GlobalSection
        headlines={[gh(1, 'https://img.example.com/1.jpg'), gh(2, 'https://img.example.com/2.jpg')]}
        onOpenArticle={jest.fn()}
      />,
    );
    expect(queryAllByTestId('global-hero-image')).toHaveLength(1);
  });
});
