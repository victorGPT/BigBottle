import type { AppConfig } from './config.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export type DifyReceiptPayload = {
  drinkList?: unknown;
  retinfoIsAvaild?: unknown;
  retinfoReceiptTime?: unknown;
  timeThreshold?: unknown;
  user_id?: unknown;
};

export async function runDify(config: AppConfig, input: { imageUrl: string; userRef: string }) {
  if (config.DIFY_MODE === 'mock') {
    return {
      drinkList: [
        {
          retinfoDrinkName: 'MOCK_WATER',
          retinfoDrinkCapacity: 500,
          retinfoDrinkAmount: 1
        }
      ],
      retinfoIsAvaild: 'true',
      retinfoReceiptTime: '2026-02-04 08:52:00',
      timeThreshold: 'false',
      user_id: input.userRef
    };
  }

  const controller = new AbortController();
  const timeoutMs = config.DIFY_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const url = new URL('/v1/workflows/run', config.DIFY_API_URL);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.DIFY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workflow_id: config.DIFY_WORKFLOW_ID,
        inputs: {
          // Dify workflow input is configured as a file input. We pass a remote URL so Dify can fetch it.
          [config.DIFY_IMAGE_INPUT_KEY]: {
            type: 'image',
            transfer_method: 'remote_url',
            url: input.imageUrl
          }
        },
        response_mode: 'blocking',
        user: input.userRef
      })
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Dify request failed: ${res.status} ${res.statusText} ${text}`);
  }
  return res.json();
}

export function extractDifyReceiptPayload(raw: unknown): DifyReceiptPayload | null {
  // Common: Dify workflow returns { data: { outputs: {...} } }
  const candidates: unknown[] = [];

  if (typeof raw === 'string') {
    try {
      candidates.push(JSON.parse(raw));
    } catch {
      // ignore
    }
  }
  candidates.push(raw);

  for (const c of candidates) {
    if (!isRecord(c)) continue;

    const direct = c as Record<string, unknown>;
    if ('drinkList' in direct || 'retinfoIsAvaild' in direct || 'timeThreshold' in direct) {
      return direct as DifyReceiptPayload;
    }

    const data = direct.data;
    if (isRecord(data)) {
      const outputs = data.outputs;
      if (isRecord(outputs)) {
        return outputs as DifyReceiptPayload;
      }
    }

    const outputs = direct.outputs;
    if (isRecord(outputs)) {
      return outputs as DifyReceiptPayload;
    }
  }

  return null;
}
