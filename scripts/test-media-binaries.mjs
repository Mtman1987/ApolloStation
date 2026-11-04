import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

// Exercise the binaries installed on this host, including the Sprite's pinned runtime.
// A missing executable remains a test failure, never a skipped broadcast check.
export function mediaBinary(name) {
  const configured = process.env[`HEARMEOUT_${name.toUpperCase()}_BINARY`];
  if (configured) {
    if (!isAbsolute(configured)) throw Error(`${name} test binary must be absolute`);
    accessSync(configured, constants.X_OK);
    return realpathSync(configured);
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    const candidate = join(directory, name);
    try { accessSync(candidate, constants.X_OK); return realpathSync(candidate); } catch {}
  }
  throw Error(`Required media test executable is missing from PATH: ${name}`);
}
