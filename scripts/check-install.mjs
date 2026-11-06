// Runs before `npm run dev` / `npm run build`: catches a missing or outdated `npm install`
// with a plain-language message instead of a "Module not found" stack trace.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const missing = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => !existsSync(join(root, "node_modules", ...name.split("/"), "package.json")));

if (missing.length) {
  console.error(`\n  FlowForge: ${missing.length} package(s) aren't installed (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ", …" : ""}).`);
  console.error("  Run this in the project folder, then try again:\n\n    npm install\n");
  process.exit(1);
}
