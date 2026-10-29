/* AI model retirement scanner: finds model IDs that are being shut down in pasted text, code, config or n8n workflow JSON.
   Runs in the browser (deadlinefix.com/ai-model-retirement) and under Node for tests (services/web/test_model_scan.js).
   Nothing is uploaded: the registry comes with the page (/model-registry.json has the same data).

   registry: [{id, provider, shutdown: "YYYY-MM-DD", replacement, note, source, match}] where match is "exact" (default),
     "prefix" (a family: every ID that starts with id) or "endpoint" (an API path found anywhere in the text).
   n8nRules: {"<node type>": [{versions: ["1", "1.1"] (optional), resource, operations: ["transcribe", ""] ("" = not set),
     params: ["model"], model, hardcoded}]} for nodes whose exported JSON leaves the model out (n8n saves a plain parameter only
     when it differs from its default) or that hardcode the model in n8n's code. */
(function (root) {
  "use strict";

  // Prefixes and suffixes that wrap a model ID on gateways and clouds (OpenRouter, Bedrock, Vertex, Gemini API, fine-tunes).
  var PREFIXES = ["openai/", "anthropic/", "google/", "models/", "us.anthropic.", "eu.anthropic.", "apac.anthropic.",
                  "global.anthropic.", "anthropic.", "azure/", "openrouter/"];

  function candidates(token) {
    var t = token.toLowerCase(), out = [t];
    var ft = /^ft:([^:]+):/.exec(t);  // ft:gpt-4o-mini-2024-07-18:org::abc123 -> fine-tune of gpt-4o-mini-2024-07-18
    if (ft) out.push(ft[1]);
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < PREFIXES.length; i++) {
        if (t.indexOf(PREFIXES[i]) === 0) { t = t.slice(PREFIXES[i].length); out.push(t); changed = true; }
      }
    }
    var bedrock = t.replace(/-v\d+(:\d+)?$/, "");  // claude-sonnet-4-5-20250929-v1:0
    if (bedrock !== t) out.push(bedrock);
    if (t.indexOf("@") > 0) out.push(t.replace("@", "-"));  // Vertex: claude-sonnet-4-5@20250929
    return out;
  }

  function index(registry) {
    var map = {exact: {}, prefix: [], endpoint: []};
    for (var i = 0; i < registry.length; i++) {
      var e = registry[i], m = e.match || "exact";
      if (m === "exact") map.exact[e.id.toLowerCase()] = e;
      else map[m].push(e);
    }
    map.prefix.sort(function (a, b) { return b.id.length - a.id.length; });  // longest family first
    return map;
  }

  function lookup(id, map) {
    if (map.exact[id]) return map.exact[id];
    for (var i = 0; i < map.prefix.length; i++) if (id.indexOf(map.prefix[i].id.toLowerCase()) === 0) return map.prefix[i];
    return null;
  }

  function daysLeft(date, today) {
    return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  }

  function finding(raw, entry, today, where, fineTune) {
    return {model: raw, id: entry.id, provider: entry.provider, shutdown: entry.shutdown, days: daysLeft(entry.shutdown, today),
            replacement: entry.replacement || "", note: entry.note || "", source: entry.source || "", where: where,
            fineTune: !!fineTune};
  }

  var TOKEN = /[A-Za-z0-9][A-Za-z0-9._:@\/-]*[A-Za-z0-9]/g;

  function matchString(s, map) {
    var hits = [], m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(s))) {
      // Very short IDs (o1, o3) also occur in ordinary text: count them only as a whole value or inside quotes.
      if (m[0].length <= 3 && s.trim() !== m[0]) {
        var before = s.charAt(m.index - 1), after = s.charAt(m.index + m[0].length);
        if (!(before === after && /["'`]/.test(before))) continue;
      }
      var c = candidates(m[0]);
      for (var i = 0; i < c.length; i++) {
        var e = lookup(c[i], map);
        if (e) { hits.push({raw: m[0], entry: e, fineTune: m[0].toLowerCase().indexOf("ft:") === 0}); break; }
      }
    }
    var low = s.toLowerCase();
    for (var j = 0; j < map.endpoint.length; j++) {
      if (low.indexOf(map.endpoint[j].id.toLowerCase()) >= 0) hits.push({raw: map.endpoint[j].id, entry: map.endpoint[j], fineTune: false});
    }
    return hits;
  }

  function scanText(text, map, today) {
    var out = [], lines = text.split(/\r?\n/);
    for (var n = 0; n < lines.length; n++) {
      var hits = matchString(lines[n], map);
      for (var i = 0; i < hits.length; i++) out.push(finding(hits[i].raw, hits[i].entry, today, "line " + (n + 1), hits[i].fineTune));
    }
    return out;
  }

  function strings(obj, acc) {
    if (typeof obj === "string") acc.push(obj);
    else if (obj && typeof obj === "object") {
      for (var k in obj) {
        // n8n keeps the list label next to a resource locator's value (cachedResultName); it can be stale after a change.
        if (Object.prototype.hasOwnProperty.call(obj, k) && k.indexOf("cachedResult") !== 0) strings(obj[k], acc);
      }
    }
    return acc;
  }

  function workflows(data) {
    if (Array.isArray(data)) return data.filter(function (w) { return w && Array.isArray(w.nodes); });
    if (data && Array.isArray(data.nodes)) return [data];
    if (data && Array.isArray(data.data)) return workflows(data.data);  // n8n public API: GET /api/v1/workflows
    return [];
  }

  function matchRule(node, list) {
    var p = node.parameters || {};
    for (var i = 0; list && i < list.length; i++) {
      var r = list[i];
      if (r.versions && r.versions.indexOf(String(node.typeVersion)) < 0) continue;
      if (r.resource && p.resource !== r.resource) continue;
      if (r.operations && r.operations.indexOf(p.operation || "") < 0) continue;
      if (!r.hardcoded && (r.params || ["model"]).some(function (k) { return p[k] !== undefined && p[k] !== ""; })) continue;
      return r;
    }
    return null;
  }

  function scanN8n(list, map, today, rules) {
    var out = [];
    list.forEach(function (wf) {
      var wfName = wf.name || "workflow";
      wf.nodes.forEach(function (node) {
        if (node.disabled) return;
        var where = wfName + " > " + (node.name || node.type);
        var hits = [];
        strings(node.parameters || {}, []).forEach(function (s) { hits = hits.concat(matchString(s, map)); });
        var seen = {};
        function add(f) {
          f.workflow = wfName; f.workflowId = wf.id || ""; f.active = !!wf.active; f.node = node.name || node.type; f.nodeType = node.type;
          out.push(f);
        }
        hits.forEach(function (h) {
          var key = h.raw.toLowerCase();
          if (seen[key]) return;
          seen[key] = 1;
          add(finding(h.raw, h.entry, today, where, h.fineTune));
        });
        var rule = matchRule(node, rules && rules[node.type]);
        if (rule) {
          var e = lookup(rule.model.toLowerCase(), map);
          if (e && !seen[rule.model.toLowerCase()]) {
            var f = finding(rule.model, e, today, where, false);
            f.implicit = true;  // not in the JSON: the node's default (never changed) or a model n8n hardcodes
            f.hardcoded = !!rule.hardcoded;
            add(f);
          }
        }
      });
    });
    return out;
  }

  function scan(input, registry, today, rules) {
    var map = index(registry), text = String(input || "").trim(), data = null;
    if (/^[\[{]/.test(text)) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    var wfs = data ? workflows(data) : [];
    if (wfs.length) return {kind: "n8n", workflows: wfs.length, findings: scanN8n(wfs, map, today, rules)};
    return {kind: "text", findings: scanText(text, map, today)};
  }

  function csvCell(v) {
    var s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;  // keep spreadsheet apps from running cells as formulas
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(findings) {
    var rows = [["where", "model", "provider", "shutdown", "days_left", "replacement", "note", "source"]];
    findings.forEach(function (f) {
      rows.push([f.where + (f.hardcoded ? " (hardcoded by n8n)" : f.implicit ? " (node default)" : ""), f.model, f.provider, f.shutdown, f.days, f.replacement, f.note, f.source]);
    });
    return rows.map(function (r) { return r.map(csvCell).join(","); }).join("\n") + "\n";
  }

  var api = {scan: scan, candidates: candidates, toCSV: toCSV, daysLeft: daysLeft};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ModelScan = api;
})(this);
