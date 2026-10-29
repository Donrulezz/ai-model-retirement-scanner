#!/usr/bin/env node
/* Scan files and folders for AI model IDs that are being shut down (OpenAI, Anthropic, Google; gateways and clouds too).

    node cli.js [path ...] [--within DAYS] [--fail-within DAYS] [--csv | --json] [--today YYYY-MM-DD] [--registry FILE]

  path            files or folders (default: the current folder). Exported n8n workflow JSON is understood, including
                  nodes whose model is a default that the export leaves out.
  --within N      only report models that shut down within N days (already shut down always counts)
  --fail-within N exit with code 1 if any finding shuts down within N days, so a CI job can block the merge
  --csv / --json  machine-readable output instead of the table

Nothing leaves your machine: the registry is the registry.json file next to this script. */
"use strict";
const fs = require("fs");
const path = require("path");
const scanner = require("./scanner.js");

const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "dist", "build", ".venv", "venv", "__pycache__", ".next", "coverage", ".tox"]);
const MAX_BYTES = 2 * 1024 * 1024;

function parseArgs(argv) {
  const o = { paths: [], within: null, failWithin: null, format: "table", today: null, registry: path.join(__dirname, "registry.json") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--within") o.within = Number(argv[++i]);
    else if (a === "--fail-within") o.failWithin = Number(argv[++i]);
    else if (a === "--csv") o.format = "csv";
    else if (a === "--json") o.format = "json";
    else if (a === "--today") o.today = argv[++i];
    else if (a === "--registry") o.registry = argv[++i];
    else if (a === "-h" || a === "--help") o.help = true;
    else o.paths.push(a);
  }
  if (!o.paths.length) o.paths.push(".");
  for (const k of ["within", "failWithin"]) if (o[k] !== null && !Number.isFinite(o[k])) throw new Error("--" + k.replace("W", "-w") + " needs a number of days");
  return o;
}

function* walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p).sort()) if (!SKIP_DIRS.has(name)) yield* walk(path.join(p, name));
  } else if (st.isFile() && st.size <= MAX_BYTES) yield p;
}

function scanPaths(opts) {
  const reg = JSON.parse(fs.readFileSync(opts.registry, "utf8"));
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const found = [];
  let files = 0;
  for (const root of opts.paths) {
    for (const file of walk(root)) {
      const buf = fs.readFileSync(file);
      if (buf.subarray(0, 8000).includes(0)) continue;  // binary
      files++;
      for (const f of scanner.scan(buf.toString("utf8"), reg.models, today, reg.n8n).findings) {
        if (opts.within !== null && f.days > opts.within) continue;
        found.push(Object.assign({ file: (path.relative(process.cwd(), file) || file).split(path.sep).join("/") }, f));
      }
    }
  }
  return { today, files, updated: reg.updated, findings: found };
}

function when(days) {
  return days < 0 ? `shut down ${-days} days ago` : days === 0 ? "shuts down today" : `in ${days} days`;
}

function table(res) {
  if (!res.findings.length) return `No retiring model IDs in ${res.files} files (registry updated ${res.updated}).\n`;
  const rows = res.findings.map(f => [`${f.file} (${f.where})`, f.model, `${f.shutdown} (${when(f.days)})`, f.replacement]);
  const w = [0, 1, 2].map(i => Math.min(60, Math.max(...rows.map(r => r[i].length), ["where", "model", "shutdown"][i].length)));
  const line = r => r.map((c, i) => (i < 3 ? c.padEnd(w[i]) : c)).join("  ");
  const soon = res.findings.filter(f => f.days <= 90).length;
  return [line(["where", "model", "shutdown", "move to"]), ...rows.map(line), "",
          `${res.findings.length} finding(s) in ${res.files} files, ${soon} due within 90 days (registry updated ${res.updated}).`, ""].join("\n");
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { process.stdout.write(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^[\s\S]*?\/\*/, "") + "\n"); return 0; }
  const res = scanPaths(opts);
  if (opts.format === "json") process.stdout.write(JSON.stringify(res, null, 2) + "\n");
  else if (opts.format === "csv") process.stdout.write(scanner.toCSV(res.findings.map(f => Object.assign({}, f, { where: `${f.file} ${f.where}` }))));
  else process.stdout.write(table(res));
  return opts.failWithin !== null && res.findings.some(f => f.days <= opts.failWithin) ? 1 : 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { process.stderr.write(`error: ${e.message}\n`); process.exitCode = 2; }
}
module.exports = { main, scanPaths, parseArgs };
