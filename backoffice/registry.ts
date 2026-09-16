import path from 'node:path';

/**
 * The apps and APIs this router mounts, as one list.
 *
 * This is the single source of truth every later backoffice feature reads:
 * status, deploys and anything else that names an app takes a `key` from here
 * and nothing else. Client input is matched against these keys — never used to
 * build a path or a command — so a request for `../../etc` fails the lookup
 * before anything touches the filesystem.
 *
 * Kept in step with the mount table in server.ts by hand. There is no
 * submodule or lockfile pinning the sub-repos, so there is nothing to derive it
 * from.
 */

export type AppKind = 'static' | 'express' | 'placeholder';

export interface RegistryEntry {
  /** Stable id. The only app-identifying value a client may supply. */
  key: string;
  name: string;
  /** Directory relative to the repo root. May not exist — apps/ is gitignored. */
  dir: string;
  /** Paths this app is mounted at, in server.ts order. */
  mounts: string[];
  kind: AppKind;
  /** Build output directory, relative to `dir`. Absent for apps with no build. */
  build?: string;
  /** nginx serves this path directly, bypassing Node (see nginx/negre.co.conf). */
  nginx?: boolean;
  note?: string;
}

export const registry: RegistryEntry[] = [
  {
    key: 'home',
    name: 'home',
    dir: 'apps/home',
    mounts: ['/'],
    kind: 'express',
    note: 'Catch-all: /, /des, /cv and the 404 handler.',
  },
  {
    key: 'bicing-api',
    name: 'bicing-api',
    dir: 'apis/bicing-api',
    mounts: ['/bicing/api/', '/bicing/api/v2/config'],
    kind: 'express',
    note: 'Two entry points: the public index, and the auth-gated config API.',
  },
  {
    key: 'bicing-2023',
    name: 'bicing-2023',
    dir: 'apps/bicing-2023',
    mounts: ['/bicing/'],
    kind: 'static',
    build: 'dist',
    nginx: true,
  },
  {
    key: 'bicing-2026',
    name: 'bicing-2026',
    dir: 'apps/bicing-2026',
    mounts: ['/bicing-2026/'],
    kind: 'static',
    build: 'dist',
  },
  {
    key: 'staging-bicing-2026',
    name: 'staging-bicing-2026',
    dir: 'apps/staging-bicing-2026',
    mounts: ['/staging-bicing-2026/'],
    kind: 'static',
    build: 'dist',
    note: 'Second clone of bicing-2026, built by hand with BASE_PATH set. No deploy.sh.',
  },
  {
    key: 'bicing-2021',
    name: 'bicing-2021',
    dir: 'apps/bicing-2021',
    mounts: ['/bicing-2021/'],
    kind: 'express',
    build: 'build',
    nginx: true,
  },
  {
    key: 'slides',
    name: 'slides',
    dir: 'apps/slides',
    mounts: ['/slides/'],
    kind: 'static',
  },
  {
    key: 'concept-app',
    name: 'concept-app',
    dir: 'apps/concept-app',
    mounts: ['/concept-app/'],
    kind: 'placeholder',
    note: 'Placeholder route in server.ts until this sub-repo exists.',
  },
];

export function lookup(key: string): RegistryEntry | undefined {
  return registry.find((entry) => entry.key === key);
}

/** Absolute path to an entry's directory. The directory may not exist. */
export function resolveDir(entry: RegistryEntry): string {
  return path.join(__dirname, '..', entry.dir);
}
