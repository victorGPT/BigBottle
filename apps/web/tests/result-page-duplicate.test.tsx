import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ResultPage from '../src/app/pages/ResultPage';

const mocks = vi.hoisted(() => {
  return {
    navigate: vi.fn(),
    apiGet: vi.fn(),
    apiPost: vi.fn()
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
    useParams: () => ({ id: 'sub-1' })
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
    apiGet: (...args: unknown[]) => mocks.apiGet(...args),
    apiPost: (...args: unknown[]) => mocks.apiPost(...args)
  };
});

describe('ResultPage', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.apiGet.mockReset();
    mocks.apiPost.mockReset();
  });

  it('shows the receipt points audit breakdown', async () => {
    mocks.apiGet.mockResolvedValue({
      submission: {
        id: 'sub-1',
        status: 'verified',
        points_base: 12,
        points_multiplier: 10,
        points_bonus_sources: [{ type: 'gm_nft', multiplier: 10, level: 10, name: 'Galaxy' }],
        points_total: 120,
        dify_drink_list: [
          {
            retinfoDrinkName: 'Water',
            retinfoDrinkCapacity: 500,
            retinfoDrinkAmount: 1
          }
        ],
        rejection_code: null,
        duplicate_of: null,
        created_at: new Date().toISOString()
      }
    });

    render(<ResultPage />);

    expect(await screen.findByText('Total points')).toBeInTheDocument();
    expect(screen.getByText('Base points')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Multiplier')).toBeInTheDocument();
    expect(screen.getByText('10x')).toBeInTheDocument();
    expect(screen.getByText('GM-NFT node: Galaxy · 10x')).toBeInTheDocument();
    expect(screen.getByText('+120')).toBeInTheDocument();
  });

  it('shows a dedicated message for duplicate receipts', async () => {
    mocks.apiGet.mockResolvedValue({
      submission: {
        id: 'sub-1',
        status: 'rejected',
        points_total: 0,
        dify_drink_list: null,
        rejection_code: 'duplicate_receipt',
        duplicate_of: 'sub-0',
        created_at: new Date().toISOString()
      }
    });

    render(<ResultPage />);

    expect(await screen.findByText('Receipt already used')).toBeInTheDocument();
    expect(screen.getByText('This receipt has already been used and cannot earn rewards again.')).toBeInTheDocument();
  });

  it('labels legacy points snapshots without inventing bonus sources', async () => {
    mocks.apiGet.mockResolvedValue({
      submission: {
        id: 'sub-1',
        status: 'verified',
        points_base: 42,
        points_multiplier: 1,
        points_bonus_sources: [{ type: 'legacy_points_total', multiplier: 1 }],
        points_total: 42,
        dify_drink_list: null,
        rejection_code: null,
        duplicate_of: null,
        created_at: new Date().toISOString()
      }
    });

    render(<ResultPage />);

    expect(await screen.findByText('Legacy receipt · final points only')).toBeInTheDocument();
    expect(screen.getByText('+42')).toBeInTheDocument();
  });

  it('shows processing state while receipt verification is still running', async () => {
    mocks.apiGet.mockResolvedValue({
      submission: {
        id: 'sub-1',
        status: 'verifying',
        points_total: 0,
        dify_drink_list: null,
        rejection_code: null,
        duplicate_of: null,
        created_at: new Date().toISOString()
      }
    });

    render(<ResultPage />);

    expect(await screen.findByText('Detecting receipt')).toBeInTheDocument();
    expect(screen.getByText('We are checking the receipt. Results will appear here automatically.')).toBeInTheDocument();
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('starts verification from an uploaded result page state', async () => {
    mocks.apiGet.mockResolvedValue({
      submission: {
        id: 'sub-1',
        status: 'uploaded',
        points_total: 0,
        dify_drink_list: null,
        rejection_code: null,
        duplicate_of: null,
        created_at: new Date().toISOString()
      }
    });
    mocks.apiPost.mockResolvedValue({
      submission: {
        id: 'sub-1',
        status: 'verifying',
        points_total: 0,
        dify_drink_list: null,
        rejection_code: null,
        duplicate_of: null,
        created_at: new Date().toISOString()
      }
    });

    render(<ResultPage />);

    expect(await screen.findByText('Detecting receipt')).toBeInTheDocument();
    expect(mocks.apiPost).toHaveBeenCalledWith('/submissions/sub-1/verify', {}, 'token');
  });
});
