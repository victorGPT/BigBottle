import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import sharp from 'sharp';

import {
  enforceReceiptPayloadBusinessRules,
  parseOpenAIChatReceiptPayload,
  prepareReceiptModelImage,
  RECEIPT_ANALYSIS_PROMPT,
  RECEIPT_ANALYSIS_PROMPT_PREVIOUS,
  RECEIPT_ANALYSIS_USER_TEXT,
  RECEIPT_ANALYSIS_USER_TEXT_PREVIOUS
} from './receipt-analysis-activities.js';

type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type PromptVariant = {
  name: 'previous' | 'current';
  systemPrompt: string;
  userText: string;
};

type PreparedImage = Awaited<ReturnType<typeof prepareReceiptModelImage>>;

function mimeTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeItems(payload: unknown): Array<{ name: string; capacity: number; amount: number }> {
  if (!isRecord(payload) || !Array.isArray(payload.drinkList)) return [];
  return payload.drinkList
    .filter(isRecord)
    .map((item) => ({
      name: String(item.retinfoDrinkName ?? '').trim().toLowerCase(),
      capacity: Number(item.retinfoDrinkCapacity ?? 0),
      amount: Number(item.retinfoDrinkAmount ?? 1)
    }))
    .sort((a, b) => `${a.name}|${a.capacity}|${a.amount}`.localeCompare(`${b.name}|${b.capacity}|${b.amount}`));
}

function summarizePayload(payload: unknown) {
  const record = isRecord(payload) ? payload : {};
  return {
    retinfoIsAvaild: record.retinfoIsAvaild ?? null,
    retinfoReceiptTime: record.retinfoReceiptTime ?? null,
    drinkList: normalizeItems(record)
  };
}

function parseEdges(): number[] {
  const arg = process.argv.find((item) => item.startsWith('--edges='));
  const raw = arg?.slice('--edges='.length) ?? process.env.RECEIPT_PROMPT_EVAL_EDGES ?? '1600,1280,1024,768';
  const edges = raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  return Array.from(new Set(edges));
}

function usageCostUsd(usage: ChatUsage | null): number | null {
  if (!usage) return null;
  const inputUsdPerM = Number(process.env.SILICONFLOW_INPUT_USD_PER_M ?? '0.2');
  const outputUsdPerM = Number(process.env.SILICONFLOW_OUTPUT_USD_PER_M ?? '1.6');
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  return (promptTokens * inputUsdPerM + completionTokens * outputUsdPerM) / 1_000_000;
}

function promptStats(variant: PromptVariant) {
  const textChars = variant.systemPrompt.length + variant.userText.length;
  return {
    text_chars: textChars,
    rough_text_tokens: Math.ceil(textChars / 4)
  };
}

function imageStats(image: PreparedImage) {
  return {
    optimized: image.optimized,
    original_bytes: image.originalBytes,
    input_bytes: image.inputBytes,
    original_width: image.originalWidth,
    original_height: image.originalHeight,
    input_width: image.inputWidth,
    input_height: image.inputHeight,
    mime_type: image.mimeType
  };
}

async function rawImage(bytes: Buffer, mimeType: string): Promise<PreparedImage> {
  let width: number | null = null;
  let height: number | null = null;
  try {
    const metadata = await sharp(bytes, { failOn: 'none' }).metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;
  } catch {
    width = null;
    height = null;
  }

  return {
    data: bytes.toString('base64'),
    mimeType,
    originalBytes: bytes.byteLength,
    inputBytes: bytes.byteLength,
    originalWidth: width,
    originalHeight: height,
    inputWidth: width,
    inputHeight: height,
    optimized: false
  };
}

async function callSiliconFlow(variant: PromptVariant, image: PreparedImage) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) throw new Error('SILICONFLOW_API_KEY is required');

  const baseUrl = process.env.SILICONFLOW_API_BASE_URL ?? 'https://api.siliconflow.cn/v1';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL('chat/completions', normalizedBaseUrl);
  const model = process.env.SILICONFLOW_MODEL ?? 'Qwen/Qwen3.6-35B-A3B';

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: variant.systemPrompt
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: variant.userText
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
      max_tokens: 1024,
      temperature: 0,
      response_format: { type: 'json_object' },
      enable_thinking: false
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${variant.name} request failed: ${res.status} ${res.statusText} ${body}`);
  }

  const raw = await res.json();
  const payload = enforceReceiptPayloadBusinessRules(parseOpenAIChatReceiptPayload(raw));
  const usage = isRecord(raw) && isRecord(raw.usage) ? (raw.usage as ChatUsage) : null;
  return {
    usage,
    cost_usd: usageCostUsd(usage),
    summary: summarizePayload(payload),
    image: imageStats(image)
  };
}

async function main() {
  const imagePath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!imagePath) {
    throw new Error('Usage: pnpm prompt:eval <receipt-image-path> [--edges=1600,1280,1024,768]');
  }

  const imageBytes = await readFile(imagePath);
  const mimeType = mimeTypeFor(imagePath);
  const previousVariant: PromptVariant = {
    name: 'previous',
    systemPrompt: RECEIPT_ANALYSIS_PROMPT_PREVIOUS,
    userText: RECEIPT_ANALYSIS_USER_TEXT_PREVIOUS
  };
  const currentVariant: PromptVariant = {
    name: 'current',
    systemPrompt: RECEIPT_ANALYSIS_PROMPT,
    userText: RECEIPT_ANALYSIS_USER_TEXT
  };

  const sourceImage = await rawImage(imageBytes, mimeType);
  const previousSource = await callSiliconFlow(previousVariant, sourceImage);
  const currentSource = await callSiliconFlow(currentVariant, sourceImage);
  const edges = parseEdges();
  const jpegQuality = Number(process.env.RECEIPT_MODEL_IMAGE_JPEG_QUALITY ?? '78');
  const resized = [];
  for (const edge of edges) {
    const image = await prepareReceiptModelImage(imageBytes, mimeType, {
      maxLongEdge: edge,
      jpegQuality
    });
    const result = await callSiliconFlow(currentVariant, image);
    resized.push({
      edge,
      ...result
    });
  }

  const previousItems = JSON.stringify(previousSource.summary.drinkList);
  const currentItems = JSON.stringify(currentSource.summary.drinkList);

  console.log(
    JSON.stringify(
      {
        image: resolve(imagePath),
        prompt_text: {
          previous: promptStats(previousVariant),
          current: promptStats(currentVariant)
        },
        prompt_compare_on_source_image: {
          saved_prompt_tokens:
            previousSource.usage?.prompt_tokens !== undefined && currentSource.usage?.prompt_tokens !== undefined
              ? previousSource.usage.prompt_tokens - currentSource.usage.prompt_tokens
              : null,
          saved_total_tokens:
            previousSource.usage?.total_tokens !== undefined && currentSource.usage?.total_tokens !== undefined
              ? previousSource.usage.total_tokens - currentSource.usage.total_tokens
              : null,
          same_validity: previousSource.summary.retinfoIsAvaild === currentSource.summary.retinfoIsAvaild,
          same_receipt_time: previousSource.summary.retinfoReceiptTime === currentSource.summary.retinfoReceiptTime,
          same_drink_items: previousItems === currentItems
        },
        source: {
          previous: previousSource,
          current: currentSource
        },
        resized_current_prompt: resized.map((item) => ({
          ...item,
          compare_to_source_current: {
            saved_prompt_tokens:
              currentSource.usage?.prompt_tokens !== undefined && item.usage?.prompt_tokens !== undefined
                ? currentSource.usage.prompt_tokens - item.usage.prompt_tokens
                : null,
            saved_total_tokens:
              currentSource.usage?.total_tokens !== undefined && item.usage?.total_tokens !== undefined
                ? currentSource.usage.total_tokens - item.usage.total_tokens
                : null,
            same_validity: currentSource.summary.retinfoIsAvaild === item.summary.retinfoIsAvaild,
            same_receipt_time: currentSource.summary.retinfoReceiptTime === item.summary.retinfoReceiptTime,
            same_drink_items: currentItems === JSON.stringify(item.summary.drinkList)
          }
        }))
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
