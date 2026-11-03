/**
 * Module resolution hooks for running the browser-side TypeScript modules
 * under Node's test runner.
 *
 * Vite resolves `@lib/*` aliases and extensionless relative imports at build
 * time. Node's test runner does not, so this hook adds both behaviours without
 * duplicating any derivation logic.
 *
 * The hook is deliberately scoped to this project's own sources: without that
 * restriction it would rewrite CommonJS requires inside dependencies such as
 * `bip39` and break them.
 */

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const libDirectory = fileURLToPath(new URL('../src/lib/', import.meta.url));

function isProjectSource(parentURL) {
  if (!parentURL?.startsWith('file:')) return false;
  return fileURLToPath(parentURL).startsWith(projectRoot);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!isProjectSource(context.parentURL)) return nextResolve(specifier, context);

    if (specifier.startsWith('@lib/')) {
      const url = pathToFileURL(`${libDirectory}${specifier.slice('@lib/'.length)}.ts`).href;
      return { url, shortCircuit: true };
    }

    if (specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL).href;
      if (!/\.[a-z]+$/i.test(url)) {
        const candidate = `${url}.ts`;
        if (existsSync(fileURLToPath(candidate))) return { url: candidate, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
