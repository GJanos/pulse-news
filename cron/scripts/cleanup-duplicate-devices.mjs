// One-off: collapse duplicate `devices` rows that share an fcm_token, keeping
// the most-recently-updated row per token (tiebreak by id). PostgREST can't
// express the self-join DELETE, so we compute the loser ids in JS and delete
// them by primary key. Dry run by default; pass --apply to actually delete.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const APPLY = process.argv.includes('--apply');

const { data: rows, error } = await db.from('devices').select('id, fcm_token, updated_at');
if (error) throw new Error(error.message);

const byToken = new Map();
const loserIds = [];
for (const r of rows) {
  const cur = byToken.get(r.fcm_token);
  const better =
    !cur || r.updated_at > cur.updated_at || (r.updated_at === cur.updated_at && r.id > cur.id);
  if (better) {
    if (cur) loserIds.push(cur.id);
    byToken.set(r.fcm_token, r);
  } else {
    loserIds.push(r.id);
  }
}

console.log(`total rows: ${rows.length}`);
console.log(`unique tokens: ${byToken.size}`);
console.log(`duplicate rows to delete: ${loserIds.length}`);
for (const id of loserIds) console.log(`  - ${id}`);

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to delete the rows above.');
  process.exit(0);
}

if (loserIds.length === 0) {
  console.log('\nNothing to delete.');
  process.exit(0);
}

const { error: delErr } = await db.from('devices').delete().in('id', loserIds);
if (delErr) throw new Error(delErr.message);
console.log(`\nDeleted ${loserIds.length} duplicate device row(s).`);
