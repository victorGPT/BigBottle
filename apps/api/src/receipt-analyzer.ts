import type { AppConfig } from './config.js';
import { extractDifyReceiptPayload, runDify, type DifyReceiptPayload } from './dify.js';
import { runTemporalReceiptAnalyzer } from './temporal-receipt-analyzer.js';

export type ReceiptAnalyzerInput = {
  imageUrl: string;
  userRef: string;
  submissionId: string;
};

export type ReceiptAnalyzerPayload = DifyReceiptPayload;

export async function runReceiptAnalyzer(config: AppConfig, input: ReceiptAnalyzerInput): Promise<unknown> {
  if (config.RECEIPT_ANALYZER_PROVIDER === 'temporal') {
    return runTemporalReceiptAnalyzer(config, input);
  }

  return runDify(config, input);
}

export function extractReceiptAnalyzerPayload(raw: unknown): ReceiptAnalyzerPayload | null {
  return extractDifyReceiptPayload(raw);
}
