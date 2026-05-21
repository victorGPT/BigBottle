import { proxyActivities } from '@temporalio/workflow';

import type {
  ReceiptAnalysisActivities,
  ReceiptVerificationWorkflowInput
} from './receipt-analysis-activities.js';

const { analyzeReceiptImage } = proxyActivities<ReceiptAnalysisActivities>({
  startToCloseTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2s',
    maximumInterval: '10s'
  }
});

export async function receiptVerificationWorkflow(input: ReceiptVerificationWorkflowInput) {
  return analyzeReceiptImage(input);
}
