import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
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

describe('GlobalSection hero source', () => {
  it('renders the #1 source as a pill on the hero', () => {
    const h1 = { ...gh(1, 'https://img.example.com/1.jpg'), sourceName: 'Hero Source' };
    const { getByTestId, getByText } = render(
      <GlobalSection headlines={[h1, gh(2)]} onOpenArticle={jest.fn()} />,
    );
    expect(getByTestId('global-hero-source')).toBeTruthy();
    expect(getByText('Hero Source')).toBeTruthy();
  });

  it('shows the #1 source exactly once (not duplicated below the hero)', () => {
    const h1 = { ...gh(1, 'https://img.example.com/1.jpg'), sourceName: 'Hero Source' };
    const h2 = { ...gh(2), sourceName: 'Other Source' };
    const { queryAllByText } = render(
      <GlobalSection headlines={[h1, h2]} onOpenArticle={jest.fn()} />,
    );
    expect(queryAllByText('Hero Source')).toHaveLength(1);
    expect(queryAllByText('Other Source')).toHaveLength(1);
  });

  it('keeps the #1 source in the row when the hero is not shown', () => {
    setPrefs(false); // images disabled → no hero
    const h1 = { ...gh(1, 'https://img.example.com/1.jpg'), sourceName: 'Hero Source' };
    const { getByText } = render(
      <GlobalSection headlines={[h1, gh(2)]} onOpenArticle={jest.fn()} />,
    );
    expect(getByText('Hero Source')).toBeTruthy();
  });
});

describe('GlobalSection onOpenArticle', () => {
  it('forwards imageUrl on the headline so the article hero can render', () => {
    const onOpenArticle = jest.fn();
    const { getByLabelText } = render(
      <GlobalSection
        headlines={[gh(1, 'https://img.example.com/1.jpg'), gh(2, 'https://img.example.com/2.jpg')]}
        onOpenArticle={onOpenArticle}
      />,
    );
    fireEvent.press(getByLabelText('Global 2'));
    expect(onOpenArticle).toHaveBeenCalledTimes(1);
    expect(onOpenArticle.mock.calls[0][0]).toMatchObject({
      title: 'Global 2',
      imageUrl: 'https://img.example.com/2.jpg',
    });
  });
});
