import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

describe("CEP installation metadata", () => {
  it("keeps the CEP bundle and extension versions aligned with package.json", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const manifest = readFileSync(join(root, "cep-plugin", "CSXS", "manifest.xml"), "utf8");
    const panel = readFileSync(join(root, "cep-plugin", "index.html"), "utf8");

    expect(manifest).toContain(`ExtensionBundleVersion="${pkg.version}"`);
    expect(manifest.match(new RegExp(`Version="${pkg.version.replaceAll(".", "\\.")}"`, "g"))).toHaveLength(3);
    expect(panel).toContain(`Version ${pkg.version}`);
  });

  it("declares Premiere compatibility with a Marketplace-safe minimum only", () => {
    const manifest = readFileSync(join(root, "cep-plugin", "CSXS", "manifest.xml"), "utf8");

    expect(manifest).toContain('<Host Name="PPRO" Version="14.0"/>');
    expect(manifest).not.toMatch(/<Host Name="PPRO" Version="[[(]/);
  });

  it("ships a separately addressed After Effects authoring connector", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const manifest = readFileSync(join(root, "after-effects-cep-plugin", "CSXS", "manifest.xml"), "utf8");
    const panel = readFileSync(join(root, "after-effects-cep-plugin", "main.js"), "utf8");
    const cli = readFileSync(join(root, "src", "index.ts"), "utf8");

    expect(pkg.files).toContain("after-effects-cep-plugin");
    expect(manifest).toContain(`ExtensionBundleVersion="${pkg.version}"`);
    expect(manifest).toContain('<Host Name="AEFT" Version="15.0"/>');
    expect(panel).toContain("after-effects-mcp-bridge");
    expect(panel).toContain("AFTER_EFFECTS_MCP_TEMP_DIR");
    expect(cli).toContain("--install-after-effects-cep");
    expect(cli).toContain('powershellArgs.push("-ConnectorHost", "AfterEffects")');
  });

  it("documents the Windows unsigned-extension value as REG_SZ", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const installer = readFileSync(join(root, "scripts", "install-cep.ps1"), "utf8");

    expect(readme).toContain("String (`REG_SZ`)");
    expect(readme).not.toContain("set these DWORD values");
    expect(installer).toContain('-PropertyType String -Value "1"');
    expect(installer).toContain("artifacts\\MCPBridgeCEP.zxp");
    expect(installer).toContain('ExtensionBundleVersion="');
    expect(installer).toContain("signedPackageMatchesRelease");
    expect(installer).toContain("embedded connector version does not match package version");
    expect(installer).toContain("Signature verification failed");
  });

  it("builds and verifies a signed Windows CEP release package", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const signer = readFileSync(join(root, "scripts", "build-signed-cep.ps1"), "utf8");
    const workflow = readFileSync(join(root, ".github", "workflows", "npm-publish.yml"), "utf8");

    expect(packageJson.files).toContain("artifacts/MCPBridgeCEP.zxp");
    expect(signer).toContain("-selfSignedCert");
    expect(signer).toContain("-verify");
    expect(workflow).toContain("build-signed-cep");
    expect(workflow).toContain("signed-cep");
  });

  it("publishes the connector on release and keeps the panel offline", () => {
    const workflow = readFileSync(join(root, ".github", "workflows", "cep-release.yml"), "utf8");
    const panel = readFileSync(join(root, "cep-plugin", "index.html"), "utf8");
    const panelLogic = readFileSync(join(root, "cep-plugin", "main.js"), "utf8");

    expect(workflow).toContain("release:");
    expect(workflow).toContain("artifacts/MCPBridgeCEP.zxp");
    expect(workflow).toContain("artifacts/MCPBridgeCEP.zxp.sha256");
    expect(workflow).toContain("ZXP_CERT_P12_BASE64");
    // The panel makes no network calls: no npm/GitHub update check, no self-updater.
    expect(existsSync(join(root, "cep-plugin", "updater.cjs"))).toBe(false);
    expect(existsSync(join(root, "cep-plugin", ".debug"))).toBe(false);
    expect(panel).not.toContain("updater.cjs");
    expect(panelLogic).not.toContain('nodeRequire("https")');
    expect(panelLogic).not.toContain('nodeRequire("http")');
    expect(panelLogic).not.toContain("registry.npmjs.org");
    expect(panelLogic).not.toContain("checkForUpdates");
    expect(panelLogic).toContain("writeResponseFile(resFilePath, response)");
    expect(panelLogic).toContain("fs.renameSync(stagedPath, filePath)");
    expect(panelLogic).toContain('"bridge-heartbeat.json"');
    expect(panelLogic).toContain("protocolVersion: 1");
    expect(panelLogic).toContain("startBridgeHeartbeat()");
    expect(panelLogic).toContain("PREMIERE_TEMP_DIR");
    expect(panelLogic).toContain('nodeRequire("process")');
    expect(panelLogic).toContain('return "mcpstate:"');
    expect(panelLogic).toContain("/^mcpstate:([01]),([01])$/");
    expect(panelLogic).not.toContain("return JSON.stringify({projectOpen:");
  });

  it("copies the macOS plugin for npm installs and supports diagnostics", () => {
    const cli = readFileSync(join(root, "src", "index.ts"), "utf8");
    const installer = readFileSync(join(root, "scripts", "install-cep.sh"), "utf8");
    expect(cli).toContain('diagnose ? "--diagnose" : "--copy"');
    expect(installer).toContain('HOST="Premiere"');
    expect(installer).toContain('for arg in "$@"; do');
    expect(installer).toContain("--after-effects");
    expect(installer).toContain('if [ "$MODE" = "--diagnose" ]');
    expect(installer).toContain("Installation verified");
  });

  it("rejects CEP installation on unsupported host operating systems", () => {
    const cli = readFileSync(join(root, "src", "index.ts"), "utf8");
    expect(cli).toContain("supported only on Windows and macOS");
  });

  it("offers an idempotent connector-only uninstall path on both supported operating systems", () => {
    const cli = readFileSync(join(root, "src", "index.ts"), "utf8");
    const windows = readFileSync(join(root, "scripts", "uninstall-cep.ps1"), "utf8");
    const macos = readFileSync(join(root, "scripts", "uninstall-cep.sh"), "utf8");

    expect(cli).toContain("--uninstall-cep");
    expect(windows).toContain("Refusing to uninstall outside the CEP extensions directory");
    expect(windows).toContain("PlayerDebugMode settings were left unchanged");
    expect(macos).toContain("--uninstall-system");
    expect(macos).toContain("PlayerDebugMode setting was left unchanged");
  });
});
