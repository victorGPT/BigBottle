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

  it('adds missing /api suffix when VITE_API_URL ends with /functions/v1', async () => {
    vi.stubEnv('VITE_API_URL', 'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}'
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiGet } = await import('../src/util/api');
    await apiGet('/me', 'token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/me'
    );
  });

  it('keeps account endpoints on normalized api path to avoid not_found', async () => {
    vi.stubEnv('VITE_API_URL', 'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/api');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}'
    });
    vi.stubGlobal('fetch', fetchMock);

    const { apiGet } = await import('../src/util/api');
    await apiGet('/account/summary', 'token');
    await apiGet('/account/achievements', 'token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/account/summary'
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://tbvkyvxdhrmfprcjyvbk.supabase.co/functions/v1/api/account/achievements'
    );
  });
});
