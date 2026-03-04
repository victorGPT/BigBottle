import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('api base url normalization', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('normalizes duplicated /api segment in VITE_API_URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/api');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}'
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiPost } = await import('../src/util/api');
    await apiPost('/submissions/init', {}, 'token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/submissions/init'
    );
  });

  it('keeps valid VITE_API_URL unchanged', async () => {
    vi.stubEnv('VITE_API_URL', 'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}'
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiPost } = await import('../src/util/api');
    await apiPost('/submissions/init', {}, 'token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/submissions/init'
    );
  });
});
