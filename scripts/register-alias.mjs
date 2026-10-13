// Lets Node resolve "@/..." imports: to src/ for the server, to frontend/ for the page's tests.
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith("@/")) {
      return nextResolve(specifier, context);
    }
    const base = context.parentURL?.includes("/frontend/") ? "frontend" : "src";
    return nextResolve(pathToFileURL(join(ROOT, base, specifier.slice(2))).href, context);
  },
});
