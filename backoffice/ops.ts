import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { type RegistryEntry, lookup, registry, resolveDir } from './registry';

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

async function executable(target: string): Promise<boolean> {
  try {
    await fs.access(target, fsConstants.X_OK);
    return true;
  } catch {
    return false;
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
  /** deploy.sh exists. Says nothing about whether it can be run. */
  hasDeployScript: boolean;
  /**
   * Exists AND is executable. startDeploy runs the script directly so its
   * shebang picks the interpreter, which means a script without +x can never
   * run — offering a Deploy button for one is offering a guaranteed 400.
   */
  deployReady: boolean;
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
    deployReady: false,
  };

  if (!present) return base;

  // git -C walks UP to the nearest enclosing repository, so a directory that is
  // not its own checkout would otherwise report THIS repo's branch and sha —
  // which reads as a deployed app sitting at the router's commit. Comparing the
  // toplevel against the directory itself is what rules that out.
  const script = path.join(dir, 'deploy.sh');
  const [toplevel, hasDeployScript, deployReady] = await Promise.all([
    git(dir, ['rev-parse', '--show-toplevel']),
    exists(script),
    executable(script),
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
    deployReady,
  };
}

/** Read-only status for every registry entry, gathered concurrently. */
export function appStatuses(): Promise<AppStatus[]> {
  return Promise.all(registry.map(statusFor));
}

/* ---- pm2 ---- */

const PM2_APP = 'negre-co-server';

export interface Pm2Process {
  name: string;
  status: string;
  pid: number | null;
  uptimeMs: number | null;
  restarts: number | null;
  memoryBytes: number | null;
  cpu: number | null;
  execMode: string | null;
  instances: number | null;
}

export interface Pm2Status {
  /** False when pm2 is not on this process's PATH — a real, reportable state. */
  available: boolean;
  processes: Pm2Process[];
  error: string | null;
}

interface RawPm2Entry {
  name?: string;
  pid?: number;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    exec_mode?: string;
    instances?: number;
  };
}

async function pm2(args: string[]): Promise<{ stdout: string } | { error: string; missing: boolean }> {
  try {
    const { stdout } = await run('pm2', args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
    return { stdout };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { error: (err as Error).message, missing: code === 'ENOENT' };
  }
}

export async function pm2Status(): Promise<Pm2Status> {
  const result = await pm2(['jlist']);
  if ('error' in result) {
    return {
      available: !result.missing,
      processes: [],
      error: result.missing ? 'pm2 is not on this process’s PATH' : result.error,
    };
  }

  try {
    const raw = JSON.parse(result.stdout) as RawPm2Entry[];
    const now = Date.now();
    return {
      available: true,
      error: null,
      processes: raw.map((entry) => ({
        name: entry.name ?? '(unnamed)',
        status: entry.pm2_env?.status ?? 'unknown',
        pid: entry.pid ?? null,
        uptimeMs: entry.pm2_env?.pm_uptime ? now - entry.pm2_env.pm_uptime : null,
        restarts: entry.pm2_env?.restart_time ?? null,
        memoryBytes: entry.monit?.memory ?? null,
        cpu: entry.monit?.cpu ?? null,
        execMode: entry.pm2_env?.exec_mode ?? null,
        instances: entry.pm2_env?.instances ?? null,
      })),
    };
  } catch {
    return { available: true, processes: [], error: 'pm2 jlist returned output that did not parse' };
  }
}

export async function pm2Logs(lines: number): Promise<{ available: boolean; text: string; error: string | null }> {
  // Clamped server-side: the only thing a client supplies here is a count, and
  // it reaches argv as a string we produce, never as text we were given.
  const count = Math.min(2000, Math.max(20, Math.floor(lines) || 200));
  const result = await pm2(['logs', PM2_APP, '--nostream', '--lines', String(count)]);
  if ('error' in result) {
    return {
      available: !result.missing,
      text: '',
      error: result.missing ? 'pm2 is not on this process’s PATH' : result.error,
    };
  }
  return { available: true, text: result.stdout, error: null };
}

/**
 * Reload the router that is serving this very request.
 *
 * The caller must have already responded: pm2 replaces this process, so
 * anything still buffered never reaches the client. The spawn is detached with
 * its streams closed so it outlives us, and it is deliberately scheduled a tick
 * later to let the response flush first.
 */
export function scheduleReload(): void {
  setTimeout(() => {
    const child = spawn('pm2', ['reload', 'ecosystem.config.js', '--update-env'], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }, 250);
}

/* ---- deploys ---- */

/**
 * A deploy runs `npm ci && npm run build` inside a sub-repo and takes minutes.
 * nginx sets no proxy_read_timeout, so it cuts a proxied request off at its
 * 60s default — a synchronous deploy endpoint would hand the browser a 504
 * while the deploy carried on invisibly, with no way to learn the outcome.
 *
 * So a deploy is a job: POST starts it and returns an id, and the client polls.
 * Jobs live in memory, which is the right lifetime for them — a pm2 reload
 * replaces this process and any history with it, and the deploy script's own
 * output is the durable record.
 */

const DEPLOY_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_JOB_OUTPUT = 256 * 1024;
const MAX_JOBS = 40;

export interface DeployJob {
  id: string;
  key: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  error: string | null;
}

const jobs = new Map<string, DeployJob>();

function forget(): void {
  if (jobs.size <= MAX_JOBS) return;
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  for (const job of finished.slice(0, jobs.size - MAX_JOBS)) jobs.delete(job.id);
}

export function getJob(id: string): DeployJob | undefined {
  return jobs.get(id);
}

export function runningJobFor(key: string): DeployJob | undefined {
  return [...jobs.values()].find((job) => job.key === key && job.status === 'running');
}

export type StartResult =
  | { ok: true; job: DeployJob }
  | { ok: false; reason: 'unknown-app' | 'no-script' | 'not-executable' | 'already-running' };

/**
 * @param key must be a registry key. It is looked up, never used to build a
 *   path — this is the one place a client-supplied value reaches a spawn, and
 *   the lookup is what keeps it from being one.
 */
export async function startDeploy(key: string): Promise<StartResult> {
  const entry = lookup(key);
  if (!entry) return { ok: false, reason: 'unknown-app' };
  if (runningJobFor(key)) return { ok: false, reason: 'already-running' };

  const dir = assertInsideRepo(resolveDir(entry));
  const script = path.join(dir, 'deploy.sh');

  if (!(await exists(script))) return { ok: false, reason: 'no-script' };
  try {
    // Run the script itself rather than `sh deploy.sh`, so its shebang decides
    // the interpreter. That means it has to be executable, and saying so beats
    // silently running it under the wrong shell.
    await fs.access(script, fsConstants.X_OK);
  } catch {
    return { ok: false, reason: 'not-executable' };
  }

  const job: DeployJob = {
    id: randomUUID(),
    key,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    output: '',
    truncated: false,
    error: null,
  };
  jobs.set(job.id, job);
  forget();

  // spawn with an explicit argv and no shell, same rule as execFile above:
  // what is banned is a shell string, not a streamed child.
  const child = spawn(script, [], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });

  const append = (chunk: Buffer) => {
    if (job.truncated) return;
    const room = MAX_JOB_OUTPUT - job.output.length;
    const text = chunk.toString('utf8');
    if (text.length >= room) {
      job.output += text.slice(0, room) + '\n… output truncated …\n';
      job.truncated = true;
    } else {
      job.output += text;
    }
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);

  const timer = setTimeout(() => {
    job.error = `Timed out after ${DEPLOY_TIMEOUT_MS / 60000} minutes`;
    child.kill('SIGKILL');
  }, DEPLOY_TIMEOUT_MS);

  child.on('error', (err) => {
    clearTimeout(timer);
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = Date.now();
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (job.status !== 'running') return;
    job.exitCode = code;
    job.status = code === 0 ? 'succeeded' : 'failed';
    job.finishedAt = Date.now();
  });

  return { ok: true, job };
}
