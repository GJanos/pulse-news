import * as fs from 'fs';
import * as path from 'path';

// The RPC tests mock supabase.rpc, so they stay green even when the function the app
// calls doesn't exist in the database (this is how delete_my_account went missing).
// This test pins the other half: every RPC the app calls must be defined in the
// schema reference. It can't see the live DB, but it catches schema.sql drift.

const SRC = path.resolve(__dirname, '..');
const SCHEMA = path.resolve(__dirname, '../../../supabase/schema.sql');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'tests' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

const calledRpcs = [
  ...new Set(
    sourceFiles(SRC).flatMap((f) =>
      [...fs.readFileSync(f, 'utf8').matchAll(/\.rpc\(\s*'([a-z_]+)'/g)].map((m) => m[1]!),
    ),
  ),
].sort();

const schema = fs.readFileSync(SCHEMA, 'utf8');

describe('schema.sql defines every RPC the app calls', () => {
  it('finds the app RPC call sites', () => {
    expect(calledRpcs).toEqual(
      expect.arrayContaining(['delete_my_account', 'link_device_to_user', 'register_device']),
    );
  });

  it.each(calledRpcs)('%s is defined in supabase/schema.sql', (name) => {
    expect(schema).toContain(`CREATE OR REPLACE FUNCTION ${name}(`);
  });
});
