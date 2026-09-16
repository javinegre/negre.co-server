/**
 * Backoffice shell.
 *
 * Bundled to backoffice/public/client.js by `yarn build:backoffice`. Like the
 * login page's bundle, it is gitignored and has to be built — predev, prestart
 * and the pm2 scripts all run `yarn build`, which covers both.
 *
 * Routing is by hash so the whole backoffice stays one static page behind a
 * single Express mount: no server-side routes to add per section.
 */

const TABS = ['users', 'apps', 'data', 'process'] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string): value is Tab {
  return (TABS as readonly string[]).includes(value);
}

function show(tab: Tab) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    el.hidden = el.dataset.panel !== tab;
  }
  for (const el of document.querySelectorAll<HTMLAnchorElement>('[data-tab]')) {
    if (el.dataset.tab === tab) {
      el.setAttribute('aria-current', 'page');
    } else {
      el.removeAttribute('aria-current');
    }
  }
}

function route() {
  const hash = location.hash.replace(/^#/, '');
  show(isTab(hash) ? hash : TABS[0]);
}

window.addEventListener('hashchange', route);
route();

// requireAdmin has already vouched for this session server-side; this is only
// so the header can say which account is looking.
async function showAdminEmail() {
  const el = document.getElementById('admin-email');
  if (!el) return;

  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'include' });
    if (!res.ok) return;
    const session = (await res.json()) as { user?: { email?: string } } | null;
    if (session?.user?.email) el.textContent = session.user.email;
  } catch {
    // Leave it blank: the page is useful without the header knowing the name.
  }
}

showAdminEmail();

// better-auth exposes sign-out as POST only — a plain link GETs it and 404s.
document.getElementById('signout')?.addEventListener('click', async () => {
  try {
    await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
  } finally {
    location.href = '/';
  }
});
