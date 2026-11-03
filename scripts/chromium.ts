import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const DEFAULT_BROWSERS_DIR = '/opt/pw-browsers';
const CHROME_RELATIVE_PATHS = [join('chrome-linux', 'chrome'), join('chrome-linux64', 'chrome')];

/**
 * Executable of a preinstalled Chromium, for when the revision this Playwright version expects
 * is not on disk (the sandbox ships its own under PLAYWRIGHT_BROWSERS_PATH).
 * Returns `undefined` when Playwright's own browser exists or nothing usable was found.
 * Browsers are never downloaded: do not run `playwright install`.
 */
export function fallbackChromiumPath(): string | undefined {
  if (existsSync(chromium.executablePath())) return undefined;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || DEFAULT_BROWSERS_DIR;
  if (!existsSync(root)) return undefined;

  const revisions = readdirSync(root)
    .map((name) => /^chromium-(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  for (const [dir] of revisions) {
    for (const relative of CHROME_RELATIVE_PATHS) {
      const candidate = join(root, dir, relative);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}
