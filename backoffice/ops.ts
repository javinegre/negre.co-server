import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { type RegistryEntry, registry, resolveDir } from './registry';

/**
 * The only module in the backoffice that spawns a process.
 *
 * Rules that hold for everything here, and for the deploy/pm2 calls a later
 * phase adds:
 *
 * - `execFile` only, never `exec` and never a shell string, so nothing is ever
 *   word-split or glob-expanded.
 * - Argv arrays are literals. The only variable is a directory taken from
 *   registry.ts, a server-side constant — no path, branch or flag from a client
 *   ever reaches a process.
 * - Every spawn gets a timeout and an output cap.
 */

const run = promisify(execFile);

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT = 64 * 1024;

const REPO_ROOT = path.join(__dirname, '..');

/**
 * Belt and braces. Registry directories are constants, so this cannot fail
 * today — but it is what makes that guarantee explicit rather than something a
 * later edit to registry.ts could quietly break.
 */
function assertInsideRepo(dir: string): string {
  const resolved = path.resolve(dir);
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`Refusing to operate outside the repo: ${resolved}`);
  }
  return resolved;
}

/** Returns null for anything that isn't a clean answer: not a repo, no git, timeout. */
async function git(dir: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Compares through symlinks, so /tmp-style indirection doesn't read as a mismatch. */
async function samePath(a: string, b: string): Promise<boolean> {
  try {
    return (await fs.realpath(a)) === (await fs.realpath(b));
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

async function modifiedAt(target: string): Promise<string | null> {
  try {
    const stat = await fs.stat(target);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

export interface AppStatus {
  key: string;
  name: string;
  mounts: string[];
  kind: RegistryEntry['kind'];
  nginx: boolean;
  note: string | null;
  /** False is normal, not an error: apps/ is gitignored and absent in a fresh clone. */
  present: boolean;
  /** Null when the directory is absent or is not a git checkout. */
  isRepo: boolean;
  branch: string | null;
  sha: string | null;
  /** Null when unknown (not a repo); otherwise the count of uncommitted entries. */
  uncommitted: number | null;
  build: { path: string; builtAt: string | null } | null;
  hasDeployScript: boolean;
}

async function statusFor(entry: RegistryEntry): Promise<AppStatus> {
  const dir = assertInsideRepo(resolveDir(entry));
  const present = await exists(dir);

  const base: AppStatus = {
    key: entry.key,
    name: entry.name,
    mounts: entry.mounts,
    kind: entry.kind,
    nginx: entry.nginx ?? false,
    note: entry.note ?? null,
    present,
    isRepo: false,
    branch: null,
    sha: null,
    uncommitted: null,
    build: null,
    hasDeployScript: false,
  };

  if (!present) return base;

  // git -C walks UP to the nearest enclosing repository, so a directory that is
  // not its own checkout would otherwise report THIS repo's branch and sha —
  // which reads as a deployed app sitting at the router's commit. Comparing the
  // toplevel against the directory itself is what rules that out.
  const [toplevel, hasDeployScript] = await Promise.all([
    git(dir, ['rev-parse', '--show-toplevel']),
    exists(path.join(dir, 'deploy.sh')),
  ]);
  const ownsCheckout = toplevel !== null && (await samePath(toplevel, dir));

  const [branch, sha, porcelain] = ownsCheckout
    ? await Promise.all([
        git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']),
        git(dir, ['rev-parse', '--short', 'HEAD']),
        git(dir, ['status', '--porcelain']),
      ])
    : [null, null, null];

  const build = entry.build
    ? { path: entry.build, builtAt: await modifiedAt(path.join(dir, entry.build)) }
    : null;

  return {
    ...base,
    isRepo: ownsCheckout,
    branch,
    sha,
    // An empty porcelain listing is a clean tree; null means we could not ask.
    uncommitted: porcelain === null ? null : porcelain === '' ? 0 : porcelain.split('\n').length,
    build,
    hasDeployScript,
  };
}

/** Read-only status for every registry entry, gathered concurrently. */
export function appStatuses(): Promise<AppStatus[]> {
  return Promise.all(registry.map(statusFor));
}
