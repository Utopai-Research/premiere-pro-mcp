# PAI fork notes

This fork of [leancoderkavy/premiere-pro-mcp](https://github.com/leancoderkavy/premiere-pro-mcp)
exists so PAI Desktop (Electron, macOS and Windows) can run the MCP stdio server
as one JavaScript file on its own pinned Node.js 24 runtime, with no npm and no
`node_modules` on the user's machine. The npm package, `npx`, the `.mcpb` and the
upstream workflows behave as before.

## What changes

| Area | Change | Why |
|---|---|---|
| Server build | `scripts/build-single-file.mjs` (`npm run build:single`) bundles `src/index.ts` with esbuild into `dist-single/premiere-pro-mcp.mjs` and writes `premiere-pro-mcp.mjs.sha256` | PAI downloads one file and verifies it by SHA-256 |
| Telemetry | The single-file build replaces `src/telemetry.ts` with `scripts/single-file/telemetry-disabled.ts`; the build fails if PostHog code reaches the bundle | No analytics client in the file, and no environment variable can enable one. The npm build keeps upstream telemetry |
| Bundle safety | `src/platform-capabilities.ts` loads its JSON manifest with a literal `import()`; `src/server.ts` takes the version from a build-time constant, falling back to `package.json` | Both used to read files next to the install directory, which a single file does not have |
| CEP panel | Removed `cep-plugin/.debug` and the panel's update check and Windows self-updater (`cep-plugin/updater.cjs`) | `.debug` opens a CEF remote-debugging port in Premiere; the panel now makes no network calls. Bridge loop, heartbeat and folder security checks are unchanged |
| ZXP signing | `scripts/build-signed-cep.ps1` signs a staged copy without `.debug`; `cep-release.yml` signs with the `ZXP_CERT_P12_BASE64` / `ZXP_CERT_PASSWORD` secrets when present (warning and throwaway certificate otherwise) and publishes `MCPBridgeCEP.zxp.sha256` | A stable signer across releases, and a checksum for the package users install |

## Cutting a release

```bash
git tag pai-N            # N increases by one per release
git push --tags
```

`.github/workflows/pai-single-file.yml` then installs dependencies, type-checks,
builds the bundle, checks the digest, smoke-tests the file from a directory with
no `node_modules` (`--version` and an MCP `initialize` over stdio), and creates or
updates the GitHub release for the tag. It can be re-run by hand with
`workflow_dispatch` and the tag name.

## What the release contains

| Asset | Content |
|---|---|
| `premiere-pro-mcp.mjs` | The stdio MCP server, one ES module, unminified, for Node.js 24 |
| `premiere-pro-mcp.mjs.sha256` | `sha256sum` line: hex digest, two spaces, file name |
| `MCPBridgeCEP.zxp` | The CEP panel, without the debug port or the update check, signed (see ZXP signing) |
| `MCPBridgeCEP.zxp.sha256` | Its digest, same format |

Run it as `node premiere-pro-mcp.mjs` (stdio). Environment variables are the
upstream ones (`PREMIERE_TEMP_DIR`, `PREMIERE_UXP_TOKEN`, ...), except that
telemetry variables are ignored.

The panel is built by the same workflow because a release created with
`GITHUB_TOKEN` does not trigger `cep-release.yml`; that workflow still attaches
the panel to `v<version>` releases, as upstream does.

## Limits of the single file

These CLI modes need files that only the npm package ships, so they do not work
from `premiere-pro-mcp.mjs`: `--install-cep`, `--uninstall-cep`, `--diagnose-cep`
(and the After Effects variants), `--doctor --apply-fixes`, `--update`.
`--check-update` still queries npm, but only when invoked explicitly; serving
stdio makes no update request.

## Build tooling

`package.json` and `package-lock.json` are unchanged: `pai-single-file.yml`
runs `npm ci` and then installs `esbuild@0.25.5` for that job only
(`npm install --no-save`). To build locally, do the same and run
`npm run build:single`.
