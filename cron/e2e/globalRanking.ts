import '../src/bootstrap';
import { createClient } from '@supabase/supabase-js';
import { loadPulseConfig } from '../src/config';
import { getLogger } from '../src/logging';
import { rankGlobalHeadlines } from '../src/rankHeadlines';
import type { RegionDigest, RegionHeadline } from '../src/types';
import { printGlobalHeadlines } from './print';

const log = getLogger('e2e:globalRanking');

function buildClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  return createClient(url, key);
}

async function main() {
  const config = loadPulseConfig();
  const db = buildClient();
  const today = new Date().toISOString().slice(0, 10);

  log.info(`Fetching persisted digests for ${today}…`);
  const { data, error } = await db.from('digests').select('region, payload').eq('date', today);

  if (error) throw new Error(`Supabase fetch failed: ${error.message}`);
  if (!data || data.length === 0) {
    log.info('No digests found for today. Run the cron first.');
    return;
  }

  const digests: RegionDigest[] = data.map((row) => ({
    region: row.region as string,
    headlines: (row.payload as { headlines: RegionHeadline[] }).headlines,
    attempts: 1,
  }));

  const totalCandidates = digests.reduce((n, d) => n + d.headlines.length, 0);
  log.info(`Loaded ${digests.length} regions — ${totalCandidates} total candidates\n`);
  digests.forEach((d) => log.info(`  ${d.region.padEnd(20)} ${d.headlines.length} headlines`));

  log.info('\nRunning global ranking…');
  const { headlines: globalHeadlines } = await rankGlobalHeadlines(digests, config);
  printGlobalHeadlines(globalHeadlines);
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
