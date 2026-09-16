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

/* ---- helpers ---- */

const API = '/backoffice/api';

interface ApiError {
  error?: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, {
    credentials: 'include',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiError;
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setError(id: string, message: string | null) {
  const node = el(id);
  if (!node) return;
  node.textContent = message ?? '';
  node.hidden = message === null;
}

function date(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Compact relative time — "in 19h", "3d ago" — for invite expiry. */
function relative(value: string | Date): string {
  const delta = new Date(value).getTime() - Date.now();
  const abs = Math.abs(delta);
  const hours = Math.round(abs / 3_600_000);
  const text = hours < 1 ? 'under an hour' : hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  return delta >= 0 ? `in ${text}` : `${text} ago`;
}

function cell(text: string, className?: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function message(tbody: HTMLElement, columns: number, text: string) {
  tbody.replaceChildren();
  const tr = document.createElement('tr');
  const td = cell(text, 'hint');
  td.colSpan = columns;
  tr.append(td);
  tbody.append(tr);
}

/* ---- type-to-confirm ---- */

function confirmPhrase(title: string, detail: string, phrase: string): Promise<boolean> {
  const dialog = el<HTMLDialogElement>('confirm');
  const input = el<HTMLInputElement>('confirm-input');
  const go = el<HTMLButtonElement>('confirm-go');
  if (!dialog || !input || !go) return Promise.resolve(false);

  el('confirm-title')!.textContent = title;
  el('confirm-detail')!.textContent = detail;
  el('confirm-phrase')!.textContent = phrase;
  input.value = '';
  go.disabled = true;

  const onInput = () => {
    go.disabled = input.value.trim() !== phrase;
  };
  input.addEventListener('input', onInput);

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        input.removeEventListener('input', onInput);
        resolve(dialog.returnValue === 'go');
      },
      { once: true },
    );
    dialog.showModal();
  });
}

/* ---- users & invites ---- */

interface UserRow {
  id: string;
  email: string;
  createdAt: string;
  passkeys: number;
}

interface InviteRow {
  id: string;
  email: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
}

let currentEmail: string | null = null;

async function loadUsers() {
  const tbody = el('users-rows');
  if (!tbody) return;

  try {
    const { users } = await call<{ users: UserRow[] }>('/users');
    setError('users-error', null);
    el('users-count')!.textContent = `${users.length} ${users.length === 1 ? 'user' : 'users'}`;

    if (users.length === 0) {
      message(tbody, 4, 'No accounts yet.');
      return;
    }

    tbody.replaceChildren();
    for (const user of users) {
      const tr = document.createElement('tr');
      tr.append(cell(user.email), cell(String(user.passkeys), 'num'), cell(date(user.createdAt), 'num'));

      const actions = document.createElement('td');
      const actionBox = document.createElement('div');
      actionBox.className = 'cell-actions';
      actions.append(actionBox);
      if (user.email === currentEmail) {
        const self = document.createElement('span');
        self.className = 'hint';
        self.textContent = 'that’s you';
        actions.append(self);
      } else {
        const del = document.createElement('button');
        del.className = 'btn sm danger';
        del.textContent = 'Delete';
        del.addEventListener('click', () => deleteUser(user));
        actionBox.append(del);
      }
      tr.append(actions);
      tbody.append(tr);
    }
  } catch (err) {
    setError('users-error', (err as Error).message);
    message(tbody, 4, 'Could not load accounts.');
  }
}

async function deleteUser(user: UserRow) {
  const ok = await confirmPhrase(
    `Delete ${user.email}?`,
    `Removes the account and its ${user.passkeys} passkey${user.passkeys === 1 ? '' : 's'}. ` +
      'Any per-user app data keyed to this account stays behind. This cannot be undone.',
    user.email,
  );
  if (!ok) return;

  try {
    await call(`/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
    await loadUsers();
  } catch (err) {
    setError('users-error', (err as Error).message);
  }
}

async function loadInvites() {
  const tbody = el('invite-rows');
  if (!tbody) return;

  try {
    const { invites } = await call<{ invites: InviteRow[] }>('/invites');

    if (invites.length === 0) {
      message(tbody, 4, 'No pending invites.');
      return;
    }

    tbody.replaceChildren();
    for (const invite of invites) {
      const tr = document.createElement('tr');
      if (invite.expired) tr.className = 'dim';

      const email = document.createElement('td');
      email.textContent = invite.email;
      if (invite.expired) {
        const pill = document.createElement('span');
        pill.className = 'pill bad';
        pill.textContent = 'expired';
        email.append(' ', pill);
      }

      tr.append(email, cell(date(invite.createdAt), 'num'), cell(relative(invite.expiresAt), 'num'));

      const actions = document.createElement('td');
      const actionBox = document.createElement('div');
      actionBox.className = 'cell-actions';
      actions.append(actionBox);

      const copy = document.createElement('button');
      copy.className = 'btn sm';
      copy.textContent = 'Copy link';
      copy.disabled = invite.expired;
      copy.addEventListener('click', () => copyText(invite.url, copy));

      const revoke = document.createElement('button');
      revoke.className = 'btn sm danger';
      revoke.textContent = 'Revoke';
      revoke.addEventListener('click', async () => {
        try {
          await call(`/invites/${encodeURIComponent(invite.id)}`, { method: 'DELETE' });
          await loadInvites();
        } catch (err) {
          setError('invite-error', (err as Error).message);
        }
      });

      actionBox.append(copy, revoke);
      tr.append(actions);
      tbody.append(tr);
    }
  } catch (err) {
    setError('invite-error', (err as Error).message);
    message(tbody, 4, 'Could not load invites.');
  }
}

async function copyText(text: string, button: HTMLButtonElement) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
  } catch {
    // Clipboard access can be refused; the link is on screen either way.
    button.textContent = 'Copy failed';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

el<HTMLFormElement>('invite-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = el<HTMLInputElement>('invite-email');
  const submit = el<HTMLButtonElement>('invite-submit');
  if (!input || !submit) return;

  submit.disabled = true;
  setError('invite-error', null);

  try {
    const invite = await call<{ email: string; url: string; expiresAt: string }>('/invites', {
      method: 'POST',
      body: JSON.stringify({ email: input.value.trim() }),
    });

    el('invite-result-email')!.textContent = `Invite minted for ${invite.email}`;
    el('invite-result-expiry')!.textContent = `expires ${relative(invite.expiresAt)}`;
    el('invite-result-url')!.textContent = invite.url;
    el('invite-result')!.hidden = false;
    input.value = '';

    await loadInvites();
  } catch (err) {
    setError('invite-error', (err as Error).message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.querySelector<HTMLElement>(button.dataset.copy!);
    if (target?.textContent) copyText(target.textContent, button);
  });
});

/* ---- apps & APIs ---- */

interface AppStatus {
  key: string;
  name: string;
  mounts: string[];
  kind: 'static' | 'express' | 'placeholder';
  nginx: boolean;
  note: string | null;
  present: boolean;
  isRepo: boolean;
  branch: string | null;
  sha: string | null;
  uncommitted: number | null;
  build: { path: string; builtAt: string | null } | null;
  hasDeployScript: boolean;
}

function pill(text: string, tone?: 'ok' | 'warn' | 'bad', withDot = true): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = tone ? `pill ${tone}` : 'pill';
  // The dot marks a live state; static labels (nginx, gated) carry none.
  if (withDot) {
    const dot = document.createElement('i');
    dot.className = 'dot';
    span.append(dot);
  }
  span.append(text);
  return span;
}

function stacked(...nodes: (Node | string)[]): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'cell-stack';
  box.append(...nodes);
  return box;
}

function mountCell(app: AppStatus): HTMLTableCellElement {
  const td = document.createElement('td');
  const box = stacked();
  for (const mount of app.mounts) {
    const line = document.createElement('span');
    line.className = 'mount-line';
    const code = document.createElement('span');
    code.className = 'path';
    code.textContent = mount;
    line.append(code);
    if (mount.includes('/v2/config')) line.append(pill('gated', undefined, false));
    box.append(line);
  }
  if (app.nginx) box.append(pill('nginx', undefined, false));
  td.append(box);
  return td;
}

function checkoutCell(app: AppStatus): HTMLTableCellElement {
  const td = document.createElement('td');

  if (!app.present) {
    td.append(pill('not checked out'));
    return td;
  }
  if (!app.isRepo) {
    td.append(pill('not a git checkout'));
    return td;
  }

  const ref = document.createElement('span');
  ref.className = 'ref';
  const branch = document.createElement('span');
  branch.className = 'mono';
  branch.textContent = app.branch ?? 'detached';
  const sha = document.createElement('span');
  sha.className = 'path';
  sha.textContent = app.sha ?? '';
  ref.append(branch, sha);

  const state =
    app.uncommitted === null
      ? pill('unknown')
      : app.uncommitted === 0
        ? pill('clean')
        : pill(`${app.uncommitted} uncommitted`, 'warn');

  td.append(stacked(ref, state));
  return td;
}

function buildCell(app: AppStatus): HTMLTableCellElement {
  if (!app.build) return cell('\u2014', 'hint');
  if (!app.build.builtAt) return cell('not built', 'hint');
  const td = cell(new Date(app.build.builtAt).toISOString().slice(0, 16).replace('T', ' '), 'num');
  td.style.color = 'var(--muted)';
  return td;
}

async function loadApps() {
  const tbody = el('apps-rows');
  if (!tbody) return;

  try {
    const { apps } = await call<{ apps: AppStatus[] }>('/apps');
    setError('apps-error', null);

    tbody.replaceChildren();
    for (const app of apps) {
      const tr = document.createElement('tr');
      if (!app.present) tr.className = 'dim';

      const name = document.createElement('td');
      const nameBox = stacked();
      const label = document.createElement('span');
      label.textContent = app.name;
      nameBox.append(label);
      if (app.note) {
        const note = document.createElement('span');
        note.className = 'hint';
        note.textContent = app.note;
        nameBox.append(note);
      }
      name.append(nameBox);

      const kind = cell(app.kind === 'placeholder' ? '\u2014' : app.kind, 'hint');

      const deploy = app.hasDeployScript
        ? cell('deploy.sh', 'hint')
        : cell(app.present ? 'no deploy.sh' : '\u2014', 'hint');

      tr.append(name, mountCell(app), kind, checkoutCell(app), buildCell(app), deploy);
      tbody.append(tr);
    }
  } catch (err) {
    setError('apps-error', (err as Error).message);
    message(tbody, 6, 'Could not load app status.');
  }
}

/**
 * One session read, used for two things: naming the account in the header, and
 * knowing which row is your own so it offers no Delete button. requireAdmin has
 * already vouched for the session server-side — this is presentation only, and
 * the API refuses a self-delete regardless of what the page renders.
 */
async function init() {
  try {
    const res = await fetch('/api/auth/get-session', { credentials: 'include' });
    if (res.ok) {
      const session = (await res.json()) as { user?: { email?: string } } | null;
      currentEmail = session?.user?.email ?? null;
    }
  } catch {
    // Leave it unset: every screen still works without knowing who is looking.
  }

  const header = el('admin-email');
  if (header && currentEmail) header.textContent = currentEmail;

  await Promise.all([loadUsers(), loadInvites(), loadApps()]);
}

init();
