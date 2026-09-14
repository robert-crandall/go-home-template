import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '../routes/login/+page.svelte';
import HomePage from '../routes/(app)/+page.svelte';

const { post, signOut } = vi.hoisted(() => ({ post: vi.fn(), signOut: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/api/client', () => ({ api: { POST: post } }));
vi.mock('$lib/auth.svelte', () => ({ auth: { signedIn: vi.fn(), signOut } }));

// These prove behavior/semantics survive theme selection. Browser inspection of
// the compiled CSS covers contrast and layout; jsdom cannot prove those.
describe.each(['light', 'dark', 'stress'])('%s screen states', (theme) => {
  it('preserves selected mode, pending submission, and a readable error slot', async () => {
    document.documentElement.dataset.theme = theme;
    const pending = Promise.withResolvers<{ error: { detail: string } }>();
    post.mockReturnValueOnce(pending.promise);
    const { container } = render(LoginPage, {
      props: { data: { registrationOpen: true, googleLoginEnabled: true, oauthError: '' } }
    });
    const modes = screen.getByRole('group', { name: 'Log in or register' });
    const login = within(modes).getByRole('button', { name: 'Log in' });
    await fireEvent.click(login);
    expect(login.getAttribute('aria-pressed')).toBe('true');
    expect(login.classList.contains('btn-primary')).toBe(true);
    expect(within(modes).getByRole('button', { name: 'Register' }).classList.contains('btn-primary')).toBe(false);
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).not.toBeNull();
    await fireEvent.input(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
    const form = container.querySelector('form');
    if (!form) throw new Error('Login form is missing');
    await fireEvent.submit(form);
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Working...' });
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute('aria-busy')).toBe('true');
    pending.resolve({ error: { detail: 'The server refused this login.' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The server refused this login.'));
    expect(screen.getByRole('alert').classList.contains('alert-error')).toBe(true);
    expect(submit.disabled).toBe(false);
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it('keeps the signed-in page usable after a refused logout', async () => {
    document.documentElement.dataset.theme = theme;
    signOut.mockClear();
    const pending = Promise.withResolvers<{ error: { detail: string } }>();
    post.mockReturnValueOnce(pending.promise);
    render(HomePage, { props: { data: { user: {
      id: 1, email: 'a@example.test', name: '', createdAt: '2026-01-01T00:00:00Z'
    } } } });
    expect(screen.getByRole('heading', { name: 'Hello' })).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Theme' })).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Logging out...' });
    expect(button.disabled).toBe(true);
    pending.resolve({ error: { detail: 'Could not revoke the session.' } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not revoke the session.'));
    expect(signOut).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
    expect(document.documentElement.dataset.theme).toBe(theme);
  });
});
