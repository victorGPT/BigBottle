import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import {
  parseOpenAIChatReceiptPayload,
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

function promptStats(variant: PromptVariant) {
  const textChars = variant.systemPrompt.length + variant.userText.length;
  return {
    text_chars: textChars,
    rough_text_tokens: Math.ceil(textChars / 4)
  };
}

async function callSiliconFlow(variant: PromptVariant, image: { data: string; mimeType: string }) {
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
  const payload = parseOpenAIChatReceiptPayload(raw);
  return {
    usage: isRecord(raw) && isRecord(raw.usage) ? (raw.usage as ChatUsage) : null,
    payload,
    summary: summarizePayload(payload)
  };
}

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    throw new Error('Usage: pnpm prompt:eval <receipt-image-path>');
  }

  const imageBytes = await readFile(imagePath);
  const image = {
    data: imageBytes.toString('base64'),
    mimeType: mimeTypeFor(imagePath)
  };
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
  const previous = await callSiliconFlow(previousVariant, image);
  const current = await callSiliconFlow(currentVariant, image);
  const previousItems = JSON.stringify(previous.summary.drinkList);
  const currentItems = JSON.stringify(current.summary.drinkList);
  const previousStats = promptStats(previousVariant);
  const currentStats = promptStats(currentVariant);

  console.log(
    JSON.stringify(
      {
        image: resolve(imagePath),
        prompt_text: {
          previous: previousStats,
          current: currentStats,
          saved_text_chars: previousStats.text_chars - currentStats.text_chars,
          saved_rough_text_tokens: previousStats.rough_text_tokens - currentStats.rough_text_tokens
        },
        api_usage: {
          previous: previous.usage,
          current: current.usage,
          saved_prompt_tokens:
            previous.usage?.prompt_tokens !== undefined && current.usage?.prompt_tokens !== undefined
              ? previous.usage.prompt_tokens - current.usage.prompt_tokens
              : null,
          saved_total_tokens:
            previous.usage?.total_tokens !== undefined && current.usage?.total_tokens !== undefined
              ? previous.usage.total_tokens - current.usage.total_tokens
              : null
        },
        result_compare: {
          same_validity: previous.summary.retinfoIsAvaild === current.summary.retinfoIsAvaild,
          same_receipt_time: previous.summary.retinfoReceiptTime === current.summary.retinfoReceiptTime,
          same_drink_items: previousItems === currentItems
        },
        previous: previous.summary,
        current: current.summary
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
