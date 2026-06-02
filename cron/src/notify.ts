import admin from 'firebase-admin';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import ws from 'ws';
import type { PulseConfig } from '@shared/config';
import type { RegionDigest } from './types';
import type { GlobalHeadline } from './rankHeadlines';
import { getLogger } from './logging';

let _db: SupabaseClient | null = null;

const FCM_BATCH_SIZE = 500;

function chunkTokens(tokens: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    chunks.push(tokens.slice(i, i + FCM_BATCH_SIZE));
  }
  return chunks;
}

function cutoffDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Initialize (or reuse) Firebase Admin SDK and return the Messaging instance. */
export function initMessaging() {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    // Private key is stored with literal \n in .env; restore real newlines at runtime.
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are required',
      );
    }
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  return admin.messaging();
}

/** Create (or return the cached) Supabase service-role client. */
export function buildClient() {
  if (!_db) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
    _db = createClient(url, key, {
      realtime: { transport: ws as unknown as WebSocketLikeConstructor },
    });
  }
  return _db;
}

export async function persistDigests(digests: RegionDigest[], config: PulseConfig): Promise<void> {
  const log = getLogger('notify');
  const db = buildClient();
  const today = new Date().toISOString().slice(0, 10);

  if (config.db.evict) {
    const { error } = await db.from('digests').delete().lt('date', cutoffDate(config.db.evictDays));
    if (error) log.warn(`Eviction failed: ${error.message}`);
    else log.info(`Evicted digests older than ${config.db.evictDays} days`);
  }

  const rows = digests.map((d) => ({
    region: d.region,
    date: today,
    payload: { headlines: d.headlines },
  }));

  const { error } = await db.from('digests').upsert(rows, { onConflict: 'region,date' });
  if (error) throw new Error(`Digest upsert failed: ${error.message}`);

  log.info(`Persisted ${rows.length} digests for ${today}`);
}

/** Upsert today's global digest into the `global_digests` table (one row per date). */
export async function persistGlobalDigest(headlines: GlobalHeadline[]): Promise<void> {
  const log = getLogger('notify');
  const db = buildClient();
  const today = new Date().toISOString().slice(0, 10);

  const { error } = await db
    .from('global_digests')
    .upsert({ date: today, payload: { headlines } }, { onConflict: 'date' });
  if (error) throw new Error(`Global digest upsert failed: ${error.message}`);

  log.info(`Persisted ${headlines.length} global headlines for ${today}`);
}

/**
 * Send FCM multicast to the given tokens and evict stale ones from the DB.
 * Accepts an optional comma-separated region list passed as notification data.
 */
export async function dispatchFcm(
  tokens: string[],
  regions = '',
): Promise<{ sent: number; total: number }> {
  const log = getLogger('notify');
  if (tokens.length === 0) return { sent: 0, total: 0 };

  // One physical device can own several `devices` rows — the per-install UUID
  // (PK) regenerates across reinstalls while Google Play Services keeps handing
  // back the same FCM token, and `fcm_token` has no unique constraint. Sending
  // the deduplicated set guarantees one notification per device.
  const uniqueTokens = Array.from(new Set(tokens));
  if (uniqueTokens.length < tokens.length) {
    log.info(`Deduplicated ${tokens.length - uniqueTokens.length} repeated token(s)`);
  }

  const messaging = initMessaging();
  const db = buildClient();
  const data: Record<string, string> = { type: 'daily_digest' };
  if (regions) data['regions'] = regions;

  let totalSent = 0;
  const staleTokens: string[] = [];
  const batches = chunkTokens(uniqueTokens);

  for (let index = 0; index < batches.length; index += 1) {
    const batchTokens = batches[index]!;
    const result = await messaging.sendEachForMulticast({
      tokens: batchTokens,
      notification: { title: 'Pulse', body: 'Your daily digest is ready' },
      data,
      android: {
        priority: 'high',
        notification: { channelId: 'default' },
      },
    });

    totalSent += result.successCount;
    log.info(
      `FCM batch ${index + 1}/${batches.length} sent ${result.successCount}/${batchTokens.length}`,
    );

    batchTokens.forEach((token, tokenIndex) => {
      const code = result.responses[tokenIndex]!.error?.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        staleTokens.push(token);
      }
    });
  }

  if (staleTokens.length > 0) {
    const { error } = await db.from('devices').delete().in('fcm_token', staleTokens);
    if (error) log.warn(`Failed to remove stale tokens: ${error.message}`);
    else log.info(`Removed ${staleTokens.length} stale tokens`);
  }

  return { sent: totalSent, total: uniqueTokens.length };
}

/** Send notifications to all registered devices. Used by the local cron runner for testing. */
export async function sendNotifications(digests: RegionDigest[]): Promise<void> {
  const log = getLogger('notify');
  const db = buildClient();

  const { data: devices, error } = await db.from('devices').select('id, fcm_token');
  if (error) throw new Error(`Failed to read device tokens: ${error.message}`);
  if (!devices || devices.length === 0) {
    log.info('No registered devices — skipping FCM dispatch');
    return;
  }

  const tokens = devices.map((d) => d.fcm_token as string);
  const regions = digests.map((d) => d.region).join(',');
  await dispatchFcm(tokens, regions);
}
