#!/usr/bin/env node
// Bundles the stdio MCP server (src/index.ts) into ONE self-contained ES module,
// dist-single/premiere-pro-mcp.mjs, for hosts that run it on their own Node.js
// runtime without npm or node_modules. Writes a sha256sum-format digest next to
// it. The npm package, `npx`, the .mcpb and the tsc build are unaffected.
//
// Differences from the npm build, all deliberate:
//   - src/telemetry.ts is replaced by scripts/single-file/telemetry-disabled.ts,
//     so no analytics client is bundled and no environment variable enables it.
//   - The version is a build-time constant (no package.json is shipped).
//   - src/index.ts reads ../package.json for --version/--doctor; here that import
//     resolves to a three-field identity module instead of the whole manifest.

import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist-single");
const outName = "premiere-pro-mcp.mjs";
const outFile = path.join(outDir, outName);

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (typeof pkg.version !== "string" || !pkg.version) throw new Error("package.json has no version");

const telemetryModule = path.join(root, "src", "telemetry.ts");
const telemetryStub = path.join(root, "scripts", "single-file", "telemetry-disabled.ts");
const entryModule = path.join(root, "src", "index.ts");
const packageJson = path.join(root, "package.json");

/** Resolve a relative `.js` specifier from TS source to the `.ts` file on disk. */
function sourcePath(resolveDir, specifier) {
  return path.resolve(resolveDir, specifier.replace(/\.js$/, ".ts"));
}

const singleFilePlugin = {
  name: "pai-single-file",
  setup(pluginBuild) {
    // Swap the telemetry module for the always-disabled stub.
    pluginBuild.onResolve({ filter: /(^|\/)telemetry\.js$/ }, (args) => {
      if (args.kind === "entry-point" || !args.resolveDir) return undefined;
      if (sourcePath(args.resolveDir, args.path) !== telemetryModule) return undefined;
      return { path: telemetryStub };
    });
    // src/index.ts imports ../package.json; give it only the fields it reads.
    pluginBuild.onResolve({ filter: /package\.json$/ }, (args) => {
      if (args.importer !== entryModule) return undefined;
      if (path.resolve(args.resolveDir, args.path) !== packageJson) return undefined;
      return { path: "package-identity.json", namespace: "pai-package-identity" };
    });
    pluginBuild.onLoad({ filter: /.*/, namespace: "pai-package-identity" }, () => ({
      contents: JSON.stringify({ name: pkg.name, version: pkg.version, homepage: pkg.homepage }),
      loader: "json",
    }));
  },
};

// Bundled CommonJS dependencies (ws) call require() for Node built-ins; an ES
// module has no require, so recreate it. __filename/__dirname are provided under
// private names and mapped with `define`, which only rewrites *free*
// references: src/index.ts declares its own top-level __filename/__dirname, and
// declaring those names again in the banner would be a duplicate declaration.
const banner = [
  'import { createRequire as __paiCreateRequire } from "node:module";',
  'import { fileURLToPath as __paiFileURLToPath } from "node:url";',
  'import { dirname as __paiDirname } from "node:path";',
  "const require = __paiCreateRequire(import.meta.url);",
  "const __pai_bundle_filename = __paiFileURLToPath(import.meta.url);",
  "const __pai_bundle_dirname = __paiDirname(__pai_bundle_filename);",
].join("\n");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: [entryModule],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: false,
  sourcemap: false,
  legalComments: "eof",
  banner: { js: banner },
  define: {
    __PREMIERE_MCP_VERSION__: JSON.stringify(pkg.version),
    __filename: "__pai_bundle_filename",
    __dirname: "__pai_bundle_dirname",
  },
  // Only optional native add-ons of `ws`. ws loads them inside try/catch and
  // falls back to its pure-JS code paths when they are absent, which they always
  // are here (no node_modules). Node built-ins are external by platform: "node".
  // `node:sqlite` in src/context/project-context-store.ts is imported through a
  // variable specifier on purpose; esbuild leaves it as a runtime import of the
  // built-in, which is the intended behaviour (JSON fallback if unavailable).
  external: ["bufferutil", "utf-8-validate"],
  plugins: [singleFilePlugin],
  logLevel: "info",
  metafile: true,
});

if (result.errors.length > 0) throw new Error("esbuild reported errors");

// Guard the two properties this build promises.
const inputs = Object.keys(result.metafile.inputs);
const leaked = inputs.filter((input) => /posthog/i.test(input) || input.replace(/\\/g, "/") === "src/telemetry.ts");
if (leaked.length > 0) throw new Error(`Telemetry code leaked into the single-file build: ${leaked.join(", ")}`);
const bundled = await readFile(outFile);
if (/posthog/i.test(bundled.toString("utf8"))) throw new Error("The single-file build still mentions PostHog");

const digest = createHash("sha256").update(bundled).digest("hex");
await writeFile(`${outFile}.sha256`, `${digest}  ${outName}\n`, "utf8");

console.log(`Single-file server: ${path.relative(root, outFile)} (${bundled.length} bytes, version ${pkg.version})`);
console.log(`SHA-256: ${digest}`);
