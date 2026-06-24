import { AsyncLocalStorage } from 'async_hooks';
import { randomBytes } from 'crypto';
import type { TimelineStep } from './types';

const runStorage = new AsyncLocalStorage<{
  steps: TimelineStep[];
}>();

export async function runWithQueryLogger<T>(fn: () => Promise<T>): Promise<{ result: T; steps: TimelineStep[] }> {
  const steps: TimelineStep[] = [];
  return runStorage.run({ steps }, async () => {
    const result = await fn();
    return { result, steps };
  });
}

export function logQueryStep(step: Omit<TimelineStep, 'id' | 'timestamp'>) {
  const store = runStorage.getStore();
  if (store) {
    store.steps.push({
      id: randomBytes(8).toString('hex'),
      timestamp: Date.now(),
      ...step,
    } as TimelineStep);
  }
}

export function getLoggedSteps(): TimelineStep[] {
  const store = runStorage.getStore();
  return store ? store.steps : [];
}
