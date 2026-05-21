import { describe, expect, it } from 'vitest';

import {
  computeReceiptTimeThreshold,
  parseGeminiReceiptPayload,
  parseOpenAIChatReceiptPayload
} from './receipt-analysis-activities.js';

describe('receipt analysis activities', () => {
  it('matches the Dify time threshold rule', () => {
    const now = new Date(2026, 4, 21, 12, 0, 0);

    expect(computeReceiptTimeThreshold('2026-05-14 12:00:00', now)).toBe('false');
    expect(computeReceiptTimeThreshold('2026-05-22 00:00:00', now)).toBe('false');
    expect(computeReceiptTimeThreshold('2026-05-14 11:59:59', now)).toBe('true');
    expect(computeReceiptTimeThreshold('2026-05-22 00:00:01', now)).toBe('true');
    expect(computeReceiptTimeThreshold('not-a-time', now)).toBe('true');
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
});
