import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ScanPage from '../src/app/pages/ScanPage';

const mocks = vi.hoisted(() => {
  return {
    navigate: vi.fn(),
    apiPost: vi.fn(),
    compressReceiptImage: vi.fn(),
    fetch: vi.fn()
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate
  };
});

vi.mock('../src/state/auth', () => {
  return {
    useAuth: () => ({
      state: { status: 'logged_in', token: 'token', user: null },
      setToken: vi.fn()
    })
  };
});

vi.mock('../src/util/api', () => {
  return {
    apiPost: (...args: unknown[]) => mocks.apiPost(...args)
  };
});

vi.mock('../src/util/receiptImageCompression', () => {
  return {
    compressReceiptImage: (...args: unknown[]) => mocks.compressReceiptImage(...args)
  };
});

describe('ScanPage', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.apiPost.mockReset();
    mocks.compressReceiptImage.mockReset();
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('compresses image before init/upload and uses compressed content_type', async () => {
    const original = new File([new Uint8Array(10)], 'a.png', { type: 'image/png' });
    const compressed = new File([new Uint8Array(5)], 'receipt.jpg', { type: 'image/jpeg' });

    mocks.compressReceiptImage.mockResolvedValue({
      file: compressed,
      report: {
        skipped: false,
        reason: 'compressed_hit_target',
        originalBytes: 10,
        outputBytes: 5,
        outputType: 'image/jpeg',
        width: 1000,
        height: 1000,
        quality: 0.8,
        hitTarget: true
      }
    });

    mocks.apiPost.mockImplementation((path: unknown) => {
      if (path === '/submissions/init') {
        return Promise.resolve({
          submission: {
            id: 'sub-1',
            status: 'pending_upload',
            image_bucket: 'bucket',
            image_key: 'key',
            points_total: 0,
            created_at: new Date().toISOString()
          },
          upload: {
            method: 'PUT',
            url: 'https://upload.example/test',
            headers: { 'Content-Type': 'image/jpeg' }
          }
        });
      }
      if (path === '/submissions/sub-1/complete') return Promise.resolve({});
      if (path === '/submissions/sub-1/verify') return Promise.resolve({});
      throw new Error(`Unexpected apiPost path: ${String(path)}`);
    });

    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });

    render(<ScanPage />);

    // Phase should go into optimizing first.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    if (!input) throw new Error('file_input_missing');

    fireEvent.change(input, { target: { files: [original] } });

    expect(await screen.findByText('OPTIMIZING…')).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.compressReceiptImage).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        '/submissions/init',
        expect.objectContaining({ content_type: 'image/jpeg' }),
        'token'
      );
    });

    await waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalledWith(
        'https://upload.example/test',
        expect.objectContaining({ method: 'PUT', body: compressed })
      );
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/result/sub-1', { replace: true });
    });
  });
});

