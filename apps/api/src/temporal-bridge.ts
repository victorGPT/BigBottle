import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@temporalio/client';
import { WorkflowIdConflictPolicy, WorkflowIdReusePolicy } from '@temporalio/common';
import { NativeConnection, Worker, type NativeConnectionOptions } from '@temporalio/worker';
import dotenv from 'dotenv';
import Fastify from 'fastify';

import { loadTemporalBridgeConfig } from './config.js';
import { createReceiptAnalysisActivities } from './receipt-analysis-activities.js';

dotenv.config();

type DifyWorkflowRunBody = {
  workflow_id?: unknown;
  inputs?: unknown;
  user?: unknown;
};

function workflowsPath(): string {
  const jsPath = fileURLToPath(new URL('./temporal-workflows.js', import.meta.url));
  if (existsSync(jsPath)) return jsPath;
  return fileURLToPath(new URL('./temporal-workflows.ts', import.meta.url));
}

function extractImageUrl(inputs: unknown): string | null {
  if (typeof inputs !== 'object' || inputs === null) return null;
  const record = inputs as Record<string, unknown>;
  const value = record.image_url ?? Object.values(record)[0];
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const url = (value as Record<string, unknown>).url;
    if (typeof url === 'string' && url.trim()) return url;
  }
  return null;
}

function workflowIdFor(imageUrl: string, userRef: string): string {
  const urlWithoutQuery = imageUrl.split('?')[0] ?? imageUrl;
  const hash = createHash('sha256').update(`${userRef}:${urlWithoutQuery}`).digest('hex').slice(0, 32);
  return `receipt-verification-${hash}`;
}

function assertAuthorized(expected: string | undefined, authorization: unknown) {
  if (!expected) return;
  if (typeof authorization !== 'string') {
    throw new Error('missing authorization');
  }
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token !== expected) {
    throw new Error('invalid authorization');
  }
}

async function main() {
  const config = loadTemporalBridgeConfig();
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
  const workerRun = worker.run();

  const client = new Client({
    connection,
    namespace: config.TEMPORAL_NAMESPACE
  });
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ ok: true }));

  app.post('/v1/workflows/run', async (request, reply) => {
    try {
      assertAuthorized(config.ANALYZER_BRIDGE_API_KEY, request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const body = request.body as DifyWorkflowRunBody;
    const imageUrl = extractImageUrl(body.inputs);
    if (!imageUrl) {
      return reply.code(400).send({ error: 'image_url is required' });
    }

    const userRef = typeof body.user === 'string' && body.user.trim() ? body.user.trim() : 'anonymous';
    const submissionId = workflowIdFor(imageUrl, userRef).replace(/^receipt-verification-/, '');
    const workflowId = workflowIdFor(imageUrl, userRef);

    const outputs = await client.workflow.execute(config.TEMPORAL_WORKFLOW_TYPE, {
      args: [{ imageUrl, userRef, submissionId }],
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workflowId,
      workflowExecutionTimeout: config.TEMPORAL_WORKFLOW_TIMEOUT_MS,
      workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE_FAILED_ONLY,
      workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING
    });

    return {
      workflow_run_id: randomUUID(),
      task_id: randomUUID(),
      data: {
        id: workflowId,
        workflow_id: typeof body.workflow_id === 'string' ? body.workflow_id : config.TEMPORAL_WORKFLOW_TYPE,
        status: 'succeeded',
        outputs
      }
    };
  });

  const shutdown = async () => {
    await app.close();
    worker.shutdown();
    await workerRun.catch(() => undefined);
    await connection.close();
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());

  await app.listen({ port: config.ANALYZER_BRIDGE_PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
