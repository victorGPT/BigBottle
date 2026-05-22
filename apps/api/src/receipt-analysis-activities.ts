import sharp from 'sharp';

import type { DifyReceiptPayload } from './dify.js';

export type ReceiptVerificationWorkflowInput = {
  imageUrl: string;
  userRef: string;
  submissionId: string;
};

export type ReceiptAnalysisActivities = ReturnType<typeof createReceiptAnalysisActivities>;

export type ReceiptAnalysisConfig = {
  RECEIPT_MODEL_PROVIDER: 'gemini' | 'siliconflow';
  GEMINI_API_KEY?: string | undefined;
  GEMINI_MODEL: string;
  GEMINI_API_BASE_URL: string;
  GEMINI_TIMEOUT_MS: number;
  GEMINI_MAX_IMAGE_BYTES: number;
  RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE: number;
  RECEIPT_MODEL_IMAGE_JPEG_QUALITY: number;
  SILICONFLOW_API_KEY?: string | undefined;
  SILICONFLOW_MODEL: string;
  SILICONFLOW_API_BASE_URL: string;
  SILICONFLOW_TIMEOUT_MS: number;
};

type GeminiPart = {
  text?: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: ReceiptModelUsage;
};

type ReceiptModelUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type ReceiptModelImage = {
  data: string;
  mimeType: string;
  originalBytes: number;
  inputBytes: number;
  originalWidth: number | null;
  originalHeight: number | null;
  inputWidth: number | null;
  inputHeight: number | null;
  optimized: boolean;
};

type ReceiptModelResult = {
  payload: DifyReceiptPayload;
  usage: ReceiptModelUsage | null;
};

export const RECEIPT_ANALYSIS_PROMPT_PREVIOUS = `# ROLE
You are a strict Receipt Analysis Engine. Your goal is to validate receipt data and extract specific drink information into a JSON format.

# RULES
1) VALIDATION_CHECK (ALL must be true; else -> 4/Failure)
   - TYPE: machine-printed or digital screen
   - FONT: uniform/consistent
   - HANDWRITING: reject if any core transactional text (item names/prices/total) is handwritten
   - STRUCTURE: has items + prices + total AND at least one commercial detail (name/logo/address/phone/transaction ID)
   - ORIGIN: POS/cash register/business-generated
   - CURRENCY GATE: if currency unit/symbol is "RP" (case-insensitive; with/without period) -> 4/Failure

2) TIME_CHECK (if 1 passed)
   - retinfoReceiptTime legible; else -> 4/Failure

3) EXTRACTION (if 2 passed)
   - find all drink items (water/soda/coffee/alcohol, etc.)
   - per drink emit:
     retinfoDrinkName: string
     retinfoDrinkCapacity: integer ml, default 0 if missing/illegible
     retinfoDrinkAmount: integer
   - then -> 4/Success

4) OUTPUT
   - Success: time format "YYYY-MM-DD HH:MM:SS"; emit Success JSON
   - Failure: emit Failure JSON

# JSON FORMATS
Success:
{"drinkList":[{"retinfoDrinkName":"<name>","retinfoDrinkCapacity":<ml_or_0>,"retinfoDrinkAmount":<qty>}],"retinfoIsAvaild":"true","retinfoReceiptTime":"<YYYY-MM-DD HH:MM:SS>"}

Failure:
{"retinfoIsAvaild":"false"}

# FINAL CONSTRAINT
Output JSON only. Do not output markdown code blocks. Do not output any other text or explanations.`;

export const RECEIPT_ANALYSIS_PROMPT = `Validate and extract a retail receipt. Return JSON only.

Reject with {"retinfoIsAvaild":"false"} if any condition is true:
- not a POS, cash-register, machine-printed, or digital business receipt
- core transaction text is handwritten
- missing items+prices+total, or missing store/logo/address/phone/transaction id
- receipt time is unreadable
- currency unit/symbol is RP, Rp, or Rp.

If no beverage items are present, reject with {"retinfoIsAvaild":"false"}.
If valid, extract every beverage item, including water, tea, soda, coffee, alcohol, juice, and similar drinks.

Success JSON:
{"drinkList":[{"retinfoDrinkName":"<name>","retinfoDrinkCapacity":<integer_ml_or_0>,"retinfoDrinkAmount":<integer_qty>}],"retinfoIsAvaild":"true","retinfoReceiptTime":"<YYYY-MM-DD HH:MM:SS>"}

Field rules:
- Normalize receipt time to YYYY-MM-DD HH:MM:SS.
- Capacity is integer ml; use 0 when missing or illegible.
- Quantity is integer; use 1 when not shown.
- No markdown, prose, or extra keys.`;

export const RECEIPT_ANALYSIS_USER_TEXT_PREVIOUS = 'Please analyze this receipt image and output JSON only.';
export const RECEIPT_ANALYSIS_USER_TEXT = 'Analyze the receipt image.';

const receiptOutputSchema = {
  type: 'OBJECT',
  properties: {
    drinkList: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          retinfoDrinkName: { type: 'STRING' },
          retinfoDrinkCapacity: { type: 'INTEGER' },
          retinfoDrinkAmount: { type: 'INTEGER' }
        },
        required: ['retinfoDrinkName', 'retinfoDrinkCapacity', 'retinfoDrinkAmount']
      }
    },
    retinfoIsAvaild: { type: 'STRING' },
    retinfoReceiptTime: { type: 'STRING' }
  },
  required: ['retinfoIsAvaild']
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function computeReceiptTimeThreshold(receiptTime: unknown, now = new Date()): 'true' | 'false' {
  if (typeof receiptTime !== 'string') return 'false';
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(receiptTime);
  if (!match) return 'false';

  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const parsed = new Date(year, month - 1, day, hour, minute, second);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second
  ) {
    return 'false';
  }

  const earliestAllowed = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const latestAllowed = now.getTime() + 12 * 60 * 60 * 1000;
  const receiptMs = parsed.getTime();
  return receiptMs >= earliestAllowed && receiptMs <= latestAllowed ? 'true' : 'false';
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1] ? fenced[1].trim() : trimmed;
}

export function parseGeminiReceiptPayload(response: unknown): DifyReceiptPayload {
  if (!isRecord(response)) {
    throw new Error('Gemini response is not an object');
  }

  const geminiResponse = response as GeminiResponse;
  const candidates = Array.isArray(geminiResponse.candidates) ? geminiResponse.candidates : [];
  const text = candidates
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini response did not include text output');
  }

  const parsed: unknown = JSON.parse(stripJsonFence(text));
  if (!isRecord(parsed)) {
    throw new Error('Gemini receipt payload is not an object');
  }

  return parsed as DifyReceiptPayload;
}

export function parseOpenAIChatReceiptPayload(response: unknown): DifyReceiptPayload {
  if (!isRecord(response)) {
    throw new Error('OpenAI-compatible response is not an object');
  }

  const chatResponse = response as OpenAIChatResponse;
  const content = chatResponse.choices?.[0]?.message?.content;
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
            .join('')
        : '';

  if (!text.trim()) {
    throw new Error('OpenAI-compatible response did not include text output');
  }

  const parsed: unknown = JSON.parse(stripJsonFence(text));
  if (!isRecord(parsed)) {
    throw new Error('OpenAI-compatible receipt payload is not an object');
  }

  return parsed as DifyReceiptPayload;
}

function hasExtractedDrinkItems(drinkList: unknown): boolean {
  return (
    Array.isArray(drinkList) &&
    drinkList.some((item) => isRecord(item) && typeof item.retinfoDrinkName === 'string' && item.retinfoDrinkName.trim() !== '')
  );
}

export function enforceReceiptPayloadBusinessRules(payload: DifyReceiptPayload): DifyReceiptPayload {
  const isValid =
    typeof payload.retinfoIsAvaild === 'string'
      ? payload.retinfoIsAvaild.trim().toLowerCase() === 'true'
      : payload.retinfoIsAvaild === true;

  if (isValid && !hasExtractedDrinkItems(payload.drinkList)) {
    return { retinfoIsAvaild: 'false' };
  }

  return payload;
}

function normalizeJpegQuality(value: number): number {
  if (!Number.isFinite(value)) return 78;
  return Math.min(100, Math.max(1, Math.round(value)));
}

export async function prepareReceiptModelImage(
  bytes: Buffer,
  mimeType: string,
  options: { maxLongEdge: number; jpegQuality: number }
): Promise<ReceiptModelImage> {
  const originalBytes = bytes.byteLength;
  let metadata: Partial<sharp.Metadata> = {};
  try {
    metadata = await sharp(bytes, { failOn: 'none' }).metadata();
  } catch {
    return {
      data: bytes.toString('base64'),
      mimeType,
      originalBytes,
      inputBytes: originalBytes,
      originalWidth: null,
      originalHeight: null,
      inputWidth: null,
      inputHeight: null,
      optimized: false
    };
  }

  const maxLongEdge = Math.max(1, Math.floor(options.maxLongEdge));
  const jpegQuality = normalizeJpegQuality(options.jpegQuality);

  try {
    const optimized = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({
        width: maxLongEdge,
        height: maxLongEdge,
        fit: 'inside',
        withoutEnlargement: true
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      data: optimized.data.toString('base64'),
      mimeType: 'image/jpeg',
      originalBytes,
      inputBytes: optimized.data.byteLength,
      originalWidth: metadata.width ?? null,
      originalHeight: metadata.height ?? null,
      inputWidth: optimized.info.width,
      inputHeight: optimized.info.height,
      optimized: true
    };
  } catch {
    return {
      data: bytes.toString('base64'),
      mimeType,
      originalBytes,
      inputBytes: originalBytes,
      originalWidth: metadata.width ?? null,
      originalHeight: metadata.height ?? null,
      inputWidth: metadata.width ?? null,
      inputHeight: metadata.height ?? null,
      optimized: false
    };
  }
}

async function fetchImageForModel(imageUrl: string, config: ReceiptAnalysisConfig): Promise<ReceiptModelImage> {
  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Receipt image fetch failed: ${res.status} ${res.statusText}`);
  }

  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > config.GEMINI_MAX_IMAGE_BYTES) {
    throw new Error(`Receipt image exceeds ${config.GEMINI_MAX_IMAGE_BYTES} bytes`);
  }

  return prepareReceiptModelImage(bytes, mimeType, {
    maxLongEdge: config.RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE,
    jpegQuality: config.RECEIPT_MODEL_IMAGE_JPEG_QUALITY
  });
}

async function callGemini(
  config: ReceiptAnalysisConfig,
  image: ReceiptModelImage
): Promise<ReceiptModelResult> {
  if (!config.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for Temporal receipt analysis worker');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.GEMINI_TIMEOUT_MS);
  const url = new URL(`/v1beta/models/${encodeURIComponent(config.GEMINI_MODEL)}:generateContent`, config.GEMINI_API_BASE_URL);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.GEMINI_API_KEY
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: image.mimeType, data: image.data } },
              { text: RECEIPT_ANALYSIS_PROMPT }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: receiptOutputSchema
        }
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini request failed: ${res.status} ${res.statusText} ${body}`);
    }

    return {
      payload: parseGeminiReceiptPayload(await res.json()),
      usage: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callSiliconFlow(
  config: ReceiptAnalysisConfig,
  image: ReceiptModelImage
): Promise<ReceiptModelResult> {
  if (!config.SILICONFLOW_API_KEY) {
    throw new Error('SILICONFLOW_API_KEY is required for SiliconFlow receipt analysis');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.SILICONFLOW_TIMEOUT_MS);
  const baseUrl = config.SILICONFLOW_API_BASE_URL.endsWith('/')
    ? config.SILICONFLOW_API_BASE_URL
    : `${config.SILICONFLOW_API_BASE_URL}/`;
  const url = new URL('chat/completions', baseUrl);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.SILICONFLOW_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.SILICONFLOW_MODEL,
        messages: [
          {
            role: 'system',
            content: RECEIPT_ANALYSIS_PROMPT
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: RECEIPT_ANALYSIS_USER_TEXT
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${image.mimeType};base64,${image.data}`
                }
              }
            ]
          }
        ],
        stream: false,
        max_tokens: 4096,
        temperature: 0,
        response_format: { type: 'json_object' },
        enable_thinking: false
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SiliconFlow request failed: ${res.status} ${res.statusText} ${body}`);
    }

    const raw = await res.json();
    return {
      payload: parseOpenAIChatReceiptPayload(raw),
      usage: isRecord(raw) && isRecord(raw.usage) ? (raw.usage as ReceiptModelUsage) : null
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function createReceiptAnalysisActivities(config: ReceiptAnalysisConfig) {
  return {
    async analyzeReceiptImage(input: ReceiptVerificationWorkflowInput): Promise<DifyReceiptPayload> {
      const image = await fetchImageForModel(input.imageUrl, config);
      const startedAt = performance.now();
      const result =
        config.RECEIPT_MODEL_PROVIDER === 'siliconflow'
          ? await callSiliconFlow(config, image)
          : await callGemini(config, image);
      const payload = enforceReceiptPayloadBusinessRules(result.payload);
      console.info('bb_receipt_model_usage', {
        submission_id: input.submissionId,
        provider: config.RECEIPT_MODEL_PROVIDER,
        model: config.RECEIPT_MODEL_PROVIDER === 'siliconflow' ? config.SILICONFLOW_MODEL : config.GEMINI_MODEL,
        duration_ms: Math.round(performance.now() - startedAt),
        image: {
          optimized: image.optimized,
          original_bytes: image.originalBytes,
          input_bytes: image.inputBytes,
          original_width: image.originalWidth,
          original_height: image.originalHeight,
          input_width: image.inputWidth,
          input_height: image.inputHeight,
          max_long_edge: config.RECEIPT_MODEL_IMAGE_MAX_LONG_EDGE,
          jpeg_quality: config.RECEIPT_MODEL_IMAGE_JPEG_QUALITY
        },
        usage: result.usage
      });
      return {
        ...payload,
        timeThreshold: computeReceiptTimeThreshold(payload.retinfoReceiptTime),
        user_id: input.userRef
      };
    }
  };
}
