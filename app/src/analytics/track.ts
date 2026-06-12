import { getSupabase } from '../supabase/client';
import { useAppStore } from '../store';
import { getLogger } from '../logger';

const log = getLogger('analytics');

export type UsageEventType = 'article_open' | 'article_read' | 'digest_viewed';

export interface UsageEventMetadata {
  region?: string;
  url?: string;
  date?: string;
}

/**
 * Fire-and-forget usage event. No-ops silently when unauthenticated or
 * Supabase is unconfigured. Never throws — analytics must not affect UX.
 */
export function trackEvent(type: UsageEventType, metadata: UsageEventMetadata = {}): void {
  const userId = useAppStore.getState().session?.user.id;
  if (!userId) return;

  const supabase = getSupabase();
  if (!supabase) return;

  void supabase
    .from('usage_events')
    .insert({ user_id: userId, event_type: type, metadata })
    .then(({ error }) => {
      if (error) log.warn(`trackEvent ${type} failed: ${error.message}`);
    });
}
