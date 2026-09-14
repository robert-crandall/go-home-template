import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import themeScript from '../../../static/theme.js?raw';
import ThemePicker from './ThemePicker.svelte';

// Execute the shipped blocking script, not a mock of the preference API.
describe('theme preference', () => {
  it.each(['system', 'light', 'dark'])('restores %s before mounting the picker', (preference) => {
    localStorage.setItem('theme', preference);
    window.eval(themeScript);
    render(ThemePicker);

    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Theme' }).value).toBe(preference);
    expect(document.documentElement.getAttribute('data-theme')).toBe(
      preference === 'system' ? null : preference
    );
  });

  it('switches, persists across a reload, and releases the explicit theme for System', async () => {
    render(ThemePicker);
    const select = screen.getByRole('combobox', { name: 'Theme' });
    await fireEvent.change(select, { target: { value: 'dark' } });
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    document.documentElement.removeAttribute('data-theme');
    window.eval(themeScript);
    expect(document.documentElement.dataset.theme).toBe('dark');

    await fireEvent.change(select, { target: { value: 'system' } });
    expect(localStorage.getItem('theme')).toBeNull();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('ignores obsolete saved themes but rejects invalid runtime choices', () => {
    localStorage.setItem('theme', 'removed-theme');
    window.eval(themeScript);
    expect(window.appTheme.get()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(() => window.appTheme.set('removed-theme')).toThrow('Unknown theme');
  });

  it('reports unavailable storage while still applying choices for this page', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError');
    });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    try {
      window.eval(themeScript);
      expect(window.appTheme.get()).toBe('system');
      window.appTheme.set('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(window.appTheme.get()).toBe('dark');
      expect(warning.mock.calls.map(([message]) => message)).toEqual([
        'Could not read the saved theme; using System.',
        'Could not save the theme; it will reset when this page reloads.'
      ]);
    } finally {
      read.mockRestore();
      write.mockRestore();
      warning.mockRestore();
    }
  });
});
