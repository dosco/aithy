import path from "node:path";
import { Queue, Worker } from "bunqueue/client";
import type { Job, Processor } from "bunqueue/client";

export interface QueueErrorReporter {
  (message: string, error: Error): void;
}

export interface EmbeddedQueueWorker<T, R> {
  queue: Queue<T>;
  worker: Worker<T, R>;
  close: () => Promise<void>;
}

interface EmbeddedQueueWorkerOptions<T, R> {
  name: string;
  stateDbPath: string;
  processor: Processor<T, R>;
  onError?: QueueErrorReporter;
}

export function bunqueueDataPath(stateDbPath: string): string {
  return path.join(path.dirname(stateDbPath), "bunqueue.db");
}

export function createEmbeddedQueueWorker<T, R>(
  opts: EmbeddedQueueWorkerOptions<T, R>,
): EmbeddedQueueWorker<T, R> {
  const dataPath = bunqueueDataPath(opts.stateDbPath);
  const queue = new Queue<T>(opts.name, {
    embedded: true,
    dataPath,
  });
  const worker = new Worker<T, R>(opts.name, opts.processor, {
    embedded: true,
    dataPath,
    useLocks: false,
  });

  worker.on("error", (error) => {
    opts.onError?.(formatQueueError(opts.name, error), error);
  });

  return {
    queue,
    worker,
    close: () => closeEmbeddedQueue(queue, worker),
  };
}

export async function closeEmbeddedQueue<T, R>(
  queue: Queue<T>,
  worker: Worker<T, R>,
): Promise<void> {
  await worker.close();
  queue.close();
}

export function isDuplicateJobWriteError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("UNIQUE constraint failed: jobs.id");
}

function formatQueueError(queueName: string, error: Error): string {
  const detail = describeQueueError(error);
  return `[${queueName}] background queue error: ${detail}`;
}

function describeQueueError(error: Error): string {
  const details: string[] = [error.message];
  const maybe = error as Error & { context?: unknown; jobId?: unknown };
  if (maybe.context) details.push(`context=${String(maybe.context)}`);
  if (maybe.jobId) details.push(`jobId=${String(maybe.jobId)}`);
  return details.join(" ");
}

export function getJobFailureAttempt(job: Job<unknown>): number {
  // bunqueue emits "failed" with the public job snapshot from before failJob()
  // increments the internal attempt counter.
  return Math.max(job.attemptsMade, job.attemptsStarted) + 1;
}
