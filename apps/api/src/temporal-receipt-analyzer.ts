import { Client, Connection, type ConnectionOptions } from '@temporalio/client';
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from '@temporalio/common';

import type { AppConfig } from './config.js';

export type TemporalReceiptAnalyzerInput = {
  imageUrl: string;
  userRef: string;
  submissionId: string;
};

export async function runTemporalReceiptAnalyzer(
  config: AppConfig,
  input: TemporalReceiptAnalyzerInput
): Promise<unknown> {
  const connectionOptions: ConnectionOptions = {
    address: config.TEMPORAL_ADDRESS,
    tls: config.TEMPORAL_TLS
  };
  if (config.TEMPORAL_API_KEY) {
    connectionOptions.apiKey = config.TEMPORAL_API_KEY;
  }

  const connection = await Connection.connect(connectionOptions);
  const client = new Client({
    connection,
    namespace: config.TEMPORAL_NAMESPACE
  });

  try {
    return await client.workflow.execute(config.TEMPORAL_WORKFLOW_TYPE, {
      args: [
        {
          imageUrl: input.imageUrl,
          userRef: input.userRef,
          submissionId: input.submissionId
        }
      ],
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId: `receipt-verification-${input.submissionId}`,
      workflowExecutionTimeout: config.TEMPORAL_WORKFLOW_TIMEOUT_MS,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING
    });
  } finally {
    await connection.close();
  }
}
