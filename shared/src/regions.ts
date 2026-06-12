export type ContinentName = 'Europe' | 'Middle East' | 'Asia' | 'Americas';

export interface Region {
  /** Display name and primary key everywhere — must match the DB `region` column. */
  region: string;
  /** ISO 3166-1 alpha-2. Used for flag image lookup. */
  country: string;
  /** Short display label shown when the user prefers codes over flags. */
  code: string;
  continent: ContinentName;
  /** ISO 4217 currency code for the primary currency of this region. */
  currency: string;
  /** Preferred news outlets passed to the cron prompt. Ignored by the app. */
  sources: string[];
}

/** All regions the app and cron currently support, in display order. */
export const REGIONS: Region[] = [
  {
    region: 'Hungary',
    country: 'HU',
    code: 'HU',
    continent: 'Europe',
    currency: 'HUF',
    sources: [
      'Telex (telex.hu)',
      'HVG (hvg.hu)',
      '444 (444.hu)',
      'Hungary Today (hungarytoday.hu)',
      'Portfolio (portfolio.hu)',
      'Index (index.hu)',
    ],
  },
  {
    region: 'Ukraine',
    country: 'UA',
    code: 'UA',
    continent: 'Europe',
    currency: 'UAH',
    sources: [
      'Kyiv Independent (kyivindependent.com)',
      'Ukrinform (ukrinform.net)',
      'The New Voice of Ukraine (english.nv.ua)',
    ],
  },
  {
    region: 'Russia',
    country: 'RU',
    code: 'RU',
    continent: 'Europe',
    currency: 'RUB',
    sources: [
      'Moscow Times (themoscowtimes.com)',
      'Radio Free Europe/Radio Liberty (rferl.org)',
      'Novaya Gazeta Europe (novayagazeta.eu)',
    ],
  },
  {
    region: 'United Kingdom',
    country: 'GB',
    code: 'GB',
    continent: 'Europe',
    currency: 'GBP',
    sources: [
      'BBC News (bbc.co.uk/news)',
      'The Guardian (theguardian.com)',
      'Sky News (news.sky.com)',
      'ITV News (itv.com/news)',
    ],
  },
  {
    region: 'Israel',
    country: 'IL',
    code: 'IL',
    continent: 'Middle East',
    currency: 'ILS',
    sources: [
      'Jerusalem Post (jpost.com)',
      'i24NEWS (i24news.tv)',
      'Times of Israel (timesofisrael.com)',
      'Ynet News (ynetnews.com)',
    ],
  },
  {
    region: 'Iran',
    country: 'IR',
    code: 'IR',
    continent: 'Middle East',
    currency: 'IRR',
    sources: [
      'Iran International (iranintl.com)',
      'Tehran Times (tehrantimes.com)',
      'Al Jazeera Iran (aljazeera.com)',
    ],
  },
  {
    region: 'China',
    country: 'CN',
    code: 'CN',
    continent: 'Asia',
    currency: 'CNY',
    sources: [
      'South China Morning Post (scmp.com)',
      'Sixth Tone (sixthtone.com)',
      'The Diplomat (thediplomat.com)',
    ],
  },
  {
    region: 'India',
    country: 'IN',
    code: 'IN',
    continent: 'Asia',
    currency: 'INR',
    sources: [
      'The Hindu (thehindu.com)',
      'NDTV (ndtv.com)',
      'Hindustan Times (hindustantimes.com)',
      'The Wire (thewire.in)',
    ],
  },
  {
    region: 'United States',
    country: 'US',
    code: 'US',
    continent: 'Americas',
    currency: 'USD',
    sources: [
      'AP News (apnews.com)',
      'NBC News (nbcnews.com)',
      'CBS News (cbsnews.com)',
      'NPR (npr.org)',
      'The Guardian US (theguardian.com)',
    ],
  },
];
