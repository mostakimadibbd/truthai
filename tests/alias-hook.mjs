// Module resolution hook for the test suite: maps the app's "@/..."
// import alias to the repo root (relative to this file, so the suite
// runs anywhere the repo is checked out) and lets extensionless
// relative imports find their .ts source.
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = path.join(repoRoot, specifier.slice(2));
    const candidate = existsSync(`${base}.ts`) ? `${base}.ts` : `${base}.tsx`;
    return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL &&
    !/\.(ts|tsx|js|mjs|json)$/.test(specifier)
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidate = path.join(path.dirname(parentPath), `${specifier}.ts`);
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
