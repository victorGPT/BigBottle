import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { NativeConnection, Worker, type NativeConnectionOptions } from '@temporalio/worker';
import dotenv from 'dotenv';

import { loadTemporalWorkerConfig } from './config.js';
import { createReceiptAnalysisActivities } from './receipt-analysis-activities.js';

dotenv.config();

function workflowsPath(): string {
  const jsPath = fileURLToPath(new URL('./temporal-workflows.js', import.meta.url));
  if (existsSync(jsPath)) return jsPath;
  return fileURLToPath(new URL('./temporal-workflows.ts', import.meta.url));
}

async function main() {
  const config = loadTemporalWorkerConfig();

  const connectionOptions: NativeConnectionOptions = {
    address: config.TEMPORAL_ADDRESS,
    tls: config.TEMPORAL_TLS
  };
  if (config.TEMPORAL_API_KEY) {
    connectionOptions.apiKey = config.TEMPORAL_API_KEY;
  }

  const connection = await NativeConnection.connect(connectionOptions);
  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    workflowsPath: workflowsPath(),
    activities: createReceiptAnalysisActivities(config)
  });

  try {
    await worker.run();
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
