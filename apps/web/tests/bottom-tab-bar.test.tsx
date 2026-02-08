import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import BottomTabBar from '../src/app/components/BottomTabBar';

describe('BottomTabBar', () => {
  it('marks active tab by route', () => {
    render(
      <MemoryRouter initialEntries={['/rewards']}>
        <BottomTabBar />
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: 'Rewards' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');
  });
});

