import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('turnstile token helper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('retries once when the invisible challenge times out', async () => {
    let renderCalls = 0;
    let executeCalls = 0;
    const remove = vi.fn();
    const callbacks = new Map<string, { callback: (token: string) => void }>();
    const timeoutCallbacks: Array<() => void> = [];

    vi.spyOn(window, 'setTimeout').mockImplementation((handler: TimerHandler, timeout?: number) => {
      if (timeout === 30_000 && typeof handler === 'function') {
        timeoutCallbacks.push(handler);
      }
      return timeoutCallbacks.length as unknown as number;
    });
    vi.spyOn(window, 'clearTimeout').mockImplementation(() => undefined);

    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
      render: (_container: HTMLElement, options: { callback: (token: string) => void }) => {
        renderCalls += 1;
        const widgetId = `widget-${renderCalls}`;
        callbacks.set(widgetId, options);
        return widgetId;
      },
      execute: (widgetId: string) => {
        executeCalls += 1;
        if (executeCalls === 2) {
          callbacks.get(widgetId)?.callback('retry-token');
        }
      },
      remove
      }
    });

    const { getTurnstileToken } = await import('../src/util/turnstile');
    const token = getTurnstileToken('submission_init');

    await Promise.resolve();
    expect(timeoutCallbacks).toHaveLength(1);
    timeoutCallbacks[0]!();
    await Promise.resolve();

    await expect(token).resolves.toBe('retry-token');
    expect(renderCalls).toBe(2);
    expect(executeCalls).toBe(2);
    expect(remove).toHaveBeenCalledWith('widget-1');
    expect(remove).toHaveBeenCalledWith('widget-2');
  });
});
