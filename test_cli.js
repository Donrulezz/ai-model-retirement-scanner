// node test_cli.js  — the command-line scanner on a temporary folder: findings, skipped folders, --within and --fail-within.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cli = require("./cli.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amrs-"));
fs.writeFileSync(path.join(dir, "app.py"), 'client.chat.completions.create(model="gpt-4o-mini")\n');
fs.mkdirSync(path.join(dir, "node_modules"));
fs.writeFileSync(path.join(dir, "node_modules", "x.js"), 'const m = "gpt-4o";\n');
fs.writeFileSync(path.join(dir, "flow.json"), JSON.stringify({ nodes: [{ name: "Chat", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", typeVersion: 1, parameters: { model: "gpt-4.1" } }] }));

const reg = path.join(__dirname, "registry.json");
let pass = 0;
function t(name, fn) { fn(); pass++; console.log("PASS " + name); }

t("finds IDs in code and n8n JSON, skips node_modules", () => {
  const r = cli.scanPaths(cli.parseArgs([dir, "--today", "2026-11-01", "--registry", reg]));
  const models = r.findings.map(f => f.model).sort();
  assert.ok(models.includes("gpt-4o-mini") && models.includes("gpt-4.1"), models.join(","));
  assert.ok(!r.findings.some(f => f.file.includes("node_modules")));
});

t("--within drops findings that are further away", () => {
  const r = cli.scanPaths(cli.parseArgs([dir, "--today", "2026-11-01", "--within", "10", "--registry", reg]));
  assert.strictEqual(r.findings.length, 0);
});

t("--fail-within sets exit code 1 only when something is due", () => {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    assert.strictEqual(cli.main([dir, "--today", "2026-11-01", "--fail-within", "90", "--registry", reg]), 1);
    assert.strictEqual(cli.main([dir, "--today", "2026-11-01", "--fail-within", "10", "--registry", reg]), 0);
  } finally { process.stdout.write = write; }
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed`);
