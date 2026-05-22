import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  computeReceiptTimeThreshold,
  enforceReceiptPayloadBusinessRules,
  parseGeminiReceiptPayload,
  parseOpenAIChatReceiptPayload,
  prepareReceiptModelImage,
  RECEIPT_ANALYSIS_PROMPT,
  RECEIPT_ANALYSIS_PROMPT_PREVIOUS,
  RECEIPT_ANALYSIS_USER_TEXT,
  RECEIPT_ANALYSIS_USER_TEXT_PREVIOUS
} from './receipt-analysis-activities.js';

describe('receipt analysis activities', () => {
  it('matches the Dify time threshold rule', () => {
    const now = new Date(2026, 4, 21, 12, 0, 0);

    expect(computeReceiptTimeThreshold('2026-05-14 12:00:00', now)).toBe('true');
    expect(computeReceiptTimeThreshold('2026-05-22 00:00:00', now)).toBe('true');
    expect(computeReceiptTimeThreshold('2026-05-14 11:59:59', now)).toBe('false');
    expect(computeReceiptTimeThreshold('2026-05-22 00:00:01', now)).toBe('false');
    expect(computeReceiptTimeThreshold('not-a-time', now)).toBe('false');
  });

  it('parses Gemini JSON text output', () => {
    const payload = parseGeminiReceiptPayload({
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"drinkList":[{"retinfoDrinkName":"Water","retinfoDrinkCapacity":500,"retinfoDrinkAmount":2}],"retinfoIsAvaild":"true","retinfoReceiptTime":"2026-05-21 10:00:00"}'
              }
            ]
          }
        }
      ]
    });

    expect(payload.retinfoIsAvaild).toBe('true');
    expect(payload.retinfoReceiptTime).toBe('2026-05-21 10:00:00');
    expect(payload.drinkList).toEqual([
      {
        retinfoDrinkName: 'Water',
        retinfoDrinkCapacity: 500,
        retinfoDrinkAmount: 2
      }
    ]);
  });

  it('parses OpenAI-compatible chat JSON text output', () => {
    const payload = parseOpenAIChatReceiptPayload({
      choices: [
        {
          message: {
            content:
              '{"drinkList":[{"retinfoDrinkName":"Coffee","retinfoDrinkCapacity":350,"retinfoDrinkAmount":1}],"retinfoIsAvaild":"true","retinfoReceiptTime":"2026-05-21 11:00:00"}'
          }
        }
      ]
    });

    expect(payload.retinfoIsAvaild).toBe('true');
    expect(payload.drinkList).toEqual([
      {
        retinfoDrinkName: 'Coffee',
        retinfoDrinkCapacity: 350,
        retinfoDrinkAmount: 1
      }
    ]);
  });

  it('keeps the compact prompt shorter than the previous production prompt', () => {
    const currentTextLength = RECEIPT_ANALYSIS_PROMPT.length + RECEIPT_ANALYSIS_USER_TEXT.length;
    const previousTextLength = RECEIPT_ANALYSIS_PROMPT_PREVIOUS.length + RECEIPT_ANALYSIS_USER_TEXT_PREVIOUS.length;

    expect(currentTextLength).toBeLessThan(previousTextLength);
  });

  it('keeps the compact prompt pinned to the receipt output contract', () => {
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('retinfoIsAvaild');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('retinfoReceiptTime');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('retinfoDrinkName');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('retinfoDrinkCapacity');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('retinfoDrinkAmount');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('YYYY-MM-DD HH:MM:SS');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('currency');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('handwritten');
    expect(RECEIPT_ANALYSIS_PROMPT).toContain('If no beverage items are present');
  });

  it('rejects valid-looking payloads with no extracted drink items', () => {
    const payload = enforceReceiptPayloadBusinessRules({
      drinkList: [],
      retinfoIsAvaild: 'true',
      retinfoReceiptTime: '2026-05-22 12:00:00'
    });

    expect(payload).toEqual({ retinfoIsAvaild: 'false' });
  });

  it('keeps valid payloads with extracted drink names', () => {
    const payload = {
      drinkList: [{ retinfoDrinkName: 'Water', retinfoDrinkCapacity: 500, retinfoDrinkAmount: 1 }],
      retinfoIsAvaild: 'true',
      retinfoReceiptTime: '2026-05-22 12:00:00'
    };

    expect(enforceReceiptPayloadBusinessRules(payload)).toBe(payload);
  });

  it('prepares receipt images for lower-cost model input', async () => {
    const source = await sharp({
      create: {
        width: 1200,
        height: 2400,
        channels: 3,
        background: '#ffffff'
      }
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const prepared = await prepareReceiptModelImage(source, 'image/jpeg', {
      maxLongEdge: 1024,
      jpegQuality: 78
    });

    expect(prepared.optimized).toBe(true);
    expect(prepared.mimeType).toBe('image/jpeg');
    expect(prepared.originalWidth).toBe(1200);
    expect(prepared.originalHeight).toBe(2400);
    expect(Math.max(prepared.inputWidth ?? 0, prepared.inputHeight ?? 0)).toBe(1024);
    expect(prepared.inputBytes).toBeLessThan(prepared.originalBytes);
  });
});
