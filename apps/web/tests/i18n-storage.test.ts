import { afterEach, describe, expect, it, vi } from 'vitest';

const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');

afterEach(() => {
  vi.resetModules();
  if (originalLocalStorage) {
    Object.defineProperty(window, 'localStorage', originalLocalStorage);
  }
});

describe('i18n storage', () => {
  it('falls back to English when language storage is unavailable during initialization', async () => {
    vi.resetModules();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      }
    });

    const module = await import('../src/i18n');

    expect(module.default.language).toBe('en');
  });

  it('does not throw when language preference storage fails during language changes', async () => {
    const module = await import('../src/i18n');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      }
    });

    await expect(module.default.changeLanguage('ja')).resolves.toBeDefined();
  });
});
