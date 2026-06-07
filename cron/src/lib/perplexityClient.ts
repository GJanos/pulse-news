type Log = { debug(msg: string): void; info(msg: string): void; warn(msg: string): void };

export interface PerplexityCompletion {
  choices: Array<{ message: { content: string } }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost: { total_cost: number };
  };
  citations?: string[];
  search_results?: Array<{ title: string; url: string; snippet?: string; date?: string }>;
}

export async function callPerplexity(
  endpoint: string,
  apiKey: string,
  payload: object,
  log: Log,
): Promise<PerplexityCompletion> {
  const MAX_ATTEMPTS = 2;
  let attempt = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res.json() as Promise<PerplexityCompletion>;
    const errBody = await res.text().catch(() => '(unreadable)');
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
      const delayMs = attempt * 2000;
      log.warn(
        `Perplexity ${res.status} — retrying in ${delayMs / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
      attempt++;
      continue;
    }
    throw new Error(`Perplexity request failed: ${res.status} ${res.statusText} — ${errBody}`);
  }
}
