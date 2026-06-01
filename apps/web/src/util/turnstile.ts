const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? '';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const CHALLENGE_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 2;

type TurnstileAction = 'submission_init' | 'reward_claim';

let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('turnstile_load_failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile_load_failed'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

async function executeTurnstile(action: TurnstileAction): Promise<string> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  document.body.appendChild(container);

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    let widgetId: string | null = null;
    let timer: number | null = null;

    const finish = (token: string | null, err?: Error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (widgetId) window.turnstile?.remove(widgetId);
      container.remove();
      if (err) reject(err);
      else resolve(token ?? '');
    };

    timer = window.setTimeout(() => {
      finish(null, new Error('turnstile_timeout'));
    }, CHALLENGE_TIMEOUT_MS);

    const renderedWidgetId = window.turnstile!.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      action,
      size: 'invisible',
      execution: 'execute',
      callback: (token: string) => finish(token),
      'error-callback': () => finish(null, new Error('turnstile_failed')),
      'expired-callback': () => finish(null, new Error('turnstile_expired'))
    } as any);
    if (!renderedWidgetId) {
      finish(null, new Error('turnstile_unavailable'));
      return;
    }
    widgetId = renderedWidgetId;
    window.turnstile!.execute(widgetId);
  });
}

export async function getTurnstileToken(action: TurnstileAction): Promise<string | null> {
  if (!TURNSTILE_SITE_KEY) return null;
  await loadTurnstileScript();
  if (!window.turnstile) throw new Error('turnstile_unavailable');

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await executeTurnstile(action);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'turnstile_timeout' || attempt === MAX_ATTEMPTS) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('turnstile_timeout');
}
