import type { GlobalHeadline } from '../src/rankHeadlines';
import type { RegionDigest } from '../src/types';

export function printHeadlines(digest: RegionDigest): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${digest.region}`);
  console.log(`${'─'.repeat(60)}`);
  digest.headlines.forEach((item, i) => {
    console.log(`${i + 1}. [${item.category ?? 'news'}] ${item.title}`);
    console.log(`   ${item.summary}`);
    if (item.detail) console.log(`   ${item.detail}`);
    console.log(`   ${item.sourceName ? `Source: ${item.sourceName}` : 'Source:'} ${item.url}`);
    const q = digest.quality?.headlines.find((h) => h.url === item.url);
    console.log(
      `   ${item.imageUrl ? `🖼  ${item.imageUrl}  (${q?.imageSource ?? '?'})` : '— no image'}\n`,
    );
  });

  // Per-region og:image summary.
  const qs = digest.quality?.headlines ?? [];
  const withImage = qs.filter((q) => q.imageUrl).length;
  const bySource = qs.reduce<Record<string, number>>((acc, q) => {
    const k = q.imageSource ?? 'none';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(bySource)
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  console.log(`  og:image: ${withImage}/${digest.headlines.length} — ${breakdown}`);
}

export function printGlobalHeadlines(headlines: GlobalHeadline[]): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  GLOBAL HEADLINES (${headlines.length})`);
  console.log(`${'═'.repeat(60)}`);
  headlines.forEach((h, i) => {
    console.log(`${i + 1}. [${h.region}] ${h.title}`);
    console.log(`   ${h.summary}`);
    if (h.detail) console.log(`   ${h.detail}`);
    console.log(`   ${h.sourceName ? `Source: ${h.sourceName}` : 'Source:'} ${h.url}\n`);
  });
}

export function printTotals(
  stats: Array<{ region: string; attempts: number; got: number }>,
  totalRegions: number,
  fetch: { prompt: number; completion: number; tokens: number; cost: number },
  ranking: { prompt: number; completion: number; tokens: number; cost: number },
  count: number,
): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  TOTAL — ${stats.length}/${totalRegions} regions`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Fetch   — ${fetch.tokens} tokens  $${fetch.cost.toFixed(6)} USD`);
  console.log(`  Ranking — ${ranking.tokens} tokens  $${ranking.cost.toFixed(6)} USD`);
  console.log(`  Combined                $${(fetch.cost + ranking.cost).toFixed(6)} USD`);
  console.log(`\n  Retries:`);
  const pad = stats.length ? Math.max(...stats.map((s) => s.region.length)) : 0;
  stats.forEach((s) => {
    console.log(
      `    ${s.region.padEnd(pad)}  ${s.attempts} attempt(s) → ${s.got}/${count} headlines`,
    );
  });
}
