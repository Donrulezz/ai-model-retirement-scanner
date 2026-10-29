// node test_scanner.js  — checks the model retirement scanner (matching rules, n8n JSON, CSV) on a test registry.
const assert = require("assert");
const S = require("./scanner.js");
let pass = 0;
function t(name, fn) { fn(); pass++; console.log("PASS " + name); }
const REG = [
  { id: "gpt-4o-mini-2024-07-18", provider: "OpenAI", shutdown: "2027-01-14", replacement: "gpt-6-luna" },
  { id: "gpt-4o-mini", provider: "OpenAI", shutdown: "2027-01-14", replacement: "gpt-6-luna" },
  { id: "gpt-4o", provider: "OpenAI", shutdown: "2027-01-14", replacement: "gpt-6-luna" },
  { id: "whisper-1", provider: "OpenAI", shutdown: "2027-02-26", replacement: "x-transcribe" },
  { id: "claude-sonnet-4-5-20250929", provider: "Anthropic", shutdown: "2026-11-30", replacement: "claude-sonnet-4-6" },
];
const TODAY = "2026-10-28";
const ids = (r) => r.findings.map((f) => f.id);

t("plain code: exact IDs only, gpt-4o does not swallow gpt-4o-mini", () => {
  const r = S.scan('client.chat.completions.create(model="gpt-4o-mini")\nm = "gpt-4o"\nx = "gpt-4o-realtime"', REG, TODAY);
  assert.strictEqual(r.kind, "text");
  assert.deepStrictEqual(ids(r), ["gpt-4o-mini", "gpt-4o"]);
  assert.strictEqual(r.findings[0].where, "line 1");
  assert.strictEqual(r.findings[1].where, "line 2");
});
t("days left counted from today", () => {
  assert.strictEqual(S.daysLeft("2027-01-14", TODAY), 78);
  assert.strictEqual(S.scan("gpt-4o", REG, "2027-01-20").findings[0].days, -6);
});
t("gateway and cloud wrappers are unwrapped", () => {
  const r = S.scan("openai/gpt-4o-mini anthropic.claude-sonnet-4-5-20250929-v1:0 us.anthropic.claude-sonnet-4-5-20250929-v1:0 " +
                   "claude-sonnet-4-5@20250929", REG, TODAY);
  assert.deepStrictEqual(ids(r), ["gpt-4o-mini", "claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929", "claude-sonnet-4-5-20250929"]);
});
t("fine-tune of a retiring base is flagged as fine-tune", () => {
  const r = S.scan("ft:gpt-4o-mini-2024-07-18:acme::A1b2C3", REG, TODAY);
  assert.deepStrictEqual(ids(r), ["gpt-4o-mini-2024-07-18"]);
  assert.strictEqual(r.findings[0].fineTune, true);
});
t("case-insensitive, keeps the text as written", () => {
  const r = S.scan("MODEL=GPT-4o-Mini", REG, TODAY);
  assert.strictEqual(r.findings[0].model, "GPT-4o-Mini");
});
t("n8n workflow: resource locator, HTTP body, disabled node skipped", () => {
  const wf = { name: "Support bot", nodes: [
    { name: "OpenAI Chat Model", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", typeVersion: 1.2,
      parameters: { model: { __rl: true, value: "gpt-4o-mini", mode: "list", cachedResultName: "GPT-4O-MINI" } } },
    { name: "HTTP Request", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
      parameters: { jsonBody: '={ "model": "whisper-1", "file": "{{ $json.f }}" }' } },
    { name: "Old", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", typeVersion: 1, disabled: true,
      parameters: { model: { __rl: true, value: "gpt-4o" } } },
  ] };
  const r = S.scan(JSON.stringify(wf), REG, TODAY);
  assert.strictEqual(r.kind, "n8n");
  assert.deepStrictEqual(ids(r), ["gpt-4o-mini", "whisper-1"]);
  assert.strictEqual(r.findings[0].where, "Support bot > OpenAI Chat Model");
});
t("n8n: node left on its default model is reported from the rules table", () => {
  const defaults = { "@n8n/n8n-nodes-langchain.lmChatOpenAi": [{ versions: ["1.2"], model: "gpt-4o-mini" }] };
  const wf = [{ name: "A", nodes: [{ name: "Chat", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", typeVersion: 1.2, parameters: { options: {} } }] }];
  const r = S.scan(JSON.stringify(wf), REG, TODAY, defaults);
  assert.deepStrictEqual(ids(r), ["gpt-4o-mini"]);
  assert.strictEqual(r.findings[0].implicit, true);
});
t("n8n: stale cachedResultName label is ignored, the value counts", () => {
  const wf = { name: "W", nodes: [{ name: "Chat", type: "x", parameters: { model: { __rl: true, value: "gpt-6-luna", cachedResultName: "GPT-4O-MINI" } } }] };
  assert.deepStrictEqual(ids(S.scan(JSON.stringify(wf), REG, TODAY)), []);
});
t("short IDs (o3) count only as a whole value or in quotes, not in prose", () => {
  const reg = REG.concat([{ id: "o3", provider: "OpenAI", shutdown: "2026-12-11" }]);
  assert.deepStrictEqual(ids(S.scan("Our 2023 offer: co3 and o3 tickets", reg, TODAY)), []);
  assert.deepStrictEqual(ids(S.scan('model = "o3"\nm=o3', reg, TODAY)), ["o3"]);
  assert.deepStrictEqual(ids(S.scan(JSON.stringify({ name: "W", nodes: [{ name: "n", type: "x", parameters: { model: "o3" } }] }), reg, TODAY)), ["o3"]);
});
t("n8n API response shape {data: [...]}", () => {
  const r = S.scan(JSON.stringify({ data: [{ name: "B", nodes: [{ name: "n", type: "x", parameters: { m: "gpt-4o" } }] }] }), REG, TODAY);
  assert.strictEqual(r.kind, "n8n"); assert.deepStrictEqual(ids(r), ["gpt-4o"]);
});
t("JSON that is not a workflow is scanned as text", () => {
  const r = S.scan('{"model": "gpt-4o-mini", "temperature": 0.2}', REG, TODAY);
  assert.strictEqual(r.kind, "text"); assert.deepStrictEqual(ids(r), ["gpt-4o-mini"]);
});
t("CSV export guards formulas and quotes commas", () => {
  const csv = S.toCSV([{ where: "=cmd", model: "gpt-4o", provider: "OpenAI", shutdown: "2027-01-14", days: 78, replacement: "a,b",
                         note: "", source: "" }]);
  assert.strictEqual(csv.split("\n")[1], "'=cmd,gpt-4o,OpenAI,2027-01-14,78,\"a,b\",,");
});
t("n8n: a set model wins over the default rule; hardcoded rule fires on resource + operation", () => {
  const rules = { "@n8n/n8n-nodes-langchain.lmChatOpenAi": [{ model: "gpt-4o-mini" }],
                  "@n8n/n8n-nodes-langchain.openAi": [{ resource: "audio", operations: ["transcribe", "translate"], model: "whisper-1", hardcoded: true }] };
  const wf = { name: "W", nodes: [
    { name: "Chat", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi", typeVersion: 1, parameters: { model: "some-new-model" } },
    { name: "Transcribe", type: "@n8n/n8n-nodes-langchain.openAi", typeVersion: 1.8, parameters: { resource: "audio", operation: "transcribe" } },
    { name: "Speak", type: "@n8n/n8n-nodes-langchain.openAi", typeVersion: 1.8, parameters: { resource: "audio", operation: "generate" } } ] };
  const r = S.scan(JSON.stringify(wf), REG, TODAY, rules);
  assert.deepStrictEqual(ids(r), ["whisper-1"]);
  assert.strictEqual(r.findings[0].hardcoded, true);
});
t("families (prefix) and endpoints; exact entries win over a family", () => {
  const reg = REG.concat([{ id: "gpt-4o-realtime", match: "prefix", provider: "OpenAI", shutdown: "2027-01-20" },
                          { id: "/v1/audio/translations", match: "endpoint", provider: "OpenAI", shutdown: "2027-02-26" }]);
  const r = S.scan("gpt-4o-realtime-preview-2024-12-17\nPOST https://api.openai.com/v1/audio/translations\ngpt-4o-mini", reg, TODAY);
  assert.deepStrictEqual(ids(r), ["gpt-4o-realtime", "/v1/audio/translations", "gpt-4o-mini"]);
  assert.strictEqual(r.findings[0].model, "gpt-4o-realtime-preview-2024-12-17");
});
console.log(`${pass} passed`);
