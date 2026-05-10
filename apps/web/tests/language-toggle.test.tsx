import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import LanguageToggle from '../src/app/components/LanguageToggle';
import i18n from '../src/i18n';

describe('LanguageToggle', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('uses a compact current-language button and opens the locale menu on demand', () => {
    render(<LanguageToggle />);

    const button = screen.getByRole('button', { name: 'Language: English' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: '日本語' })).toBeInTheDocument();
  });

  it('changes language from the menu and collapses after selection', async () => {
    render(<LanguageToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '日本語' }));

    expect(await screen.findByRole('button', { name: '言語: 日本語' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
