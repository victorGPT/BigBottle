import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ResultPage from '../src/app/pages/ResultPage';

const mocks = vi.hoisted(() => {
  return {
    navigate: vi.fn(),
    apiGet: vi.fn()
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
    apiGet: (...args: unknown[]) => mocks.apiGet(...args)
  };
});

describe('ResultPage', () => {
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

    expect(await screen.findByText('RECEIPT ALREADY USED')).toBeInTheDocument();
    expect(screen.getByText('该小票已被使用，无法重复领取积分。')).toBeInTheDocument();
  });
});

