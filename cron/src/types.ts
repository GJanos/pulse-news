import type { ImageSource } from './lib/ogImage';

export interface RegionHeadline {
  title: string;
  summary: string;
  detail?: string;
  url: string;
  category?: string;
  sourceName?: string;
  /** Computed by image matching — not yet persisted to the DB. */
  imageUrl?: string;
}

export interface DigestUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface RegionDigest {
  region: string;
  headlines: RegionHeadline[];
  usage?: DigestUsage;
  rankingUsage?: DigestUsage;
  attempts: number;
  /** Quality signals for the run log — not persisted to the DB. */
  quality?: DigestQuality;
}

export interface DigestRequest {
  region: string;
  country: string;
  sources: string[];
  count?: number;
}

export interface DigestSource {
  fetchDigest(request: DigestRequest): Promise<RegionDigest>;
}

export interface HeadlineQuality {
  title: string;
  url: string;
  /** Whether the URL came from search_results (preferred) or the model's suggestion (fallback). */
  urlSource: 'search_results' | 'model';
  /** Word-overlap score from matchUrl — 0 means model fallback was used. */
  urlMatchScore: number;
  /** 0-based index into the recency sequence that produced this headline. */
  recencyRound: number;
  /** True when Perplexity embedded a hyperlink inside the summary text. */
  summaryHasUrl: boolean;
  /** og:image outputs (spike) — computed, not persisted. */
  imageUrl?: string;
  imageSource?: ImageSource;
}

export interface DigestQuality {
  region: string;
  country: string;
  /** ok = full count reached; partial = some headlines collected; empty = none passed filters. */
  status: 'ok' | 'partial' | 'empty';
  attemptsUsed: number;
  recenciesUsed: string[];
  /** Total raw items returned by the model across all attempts. */
  candidatesGenerated: number;
  /** Items dropped by URL/placeholder filters (video, topic pages, junk paths). */
  urlFilterDropCount: number;
  /** Items where matchUrl found no search_results match and fell back to the model URL. */
  modelFallbackCount: number;
  /** Items dropped by topic deduplication. */
  topicDropCount: number;
  /** (urlFilterDropCount + topicDropCount) / candidatesGenerated — overall pipeline rejection rate. */
  filterRejectRate: number;
  /** Mean urlMatchScore across accepted headlines — 0 means all used model URL fallback. */
  avgUrlMatchScore: number;
  /**
   * Average pairwise Jaccard dissimilarity across headline titles.
   * 0 = all headlines about the same topic, 1 = completely distinct topics.
   */
  avgTopicSpread: number;
  headlines: HeadlineQuality[];
  usage: DigestUsage;
}
