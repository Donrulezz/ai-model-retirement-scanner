# ai-model-retirement-scanner

**Find every AI model ID in your code, config and n8n workflows that is about to be shut down (gpt-4o, gpt-4.1,
gpt-4o-mini, whisper-1, tts-1, Claude Sonnet 4.5, Gemini previews and more), with the date and what to move to.**

When a provider retires a model, requests to it fail. OpenAI shuts down `gpt-4o`, `gpt-4o-mini` and `gpt-4.1` on
14 January 2027, and other models go earlier. Model names hide in prompts, `.env` files, YAML, notebooks and in n8n
nodes whose export leaves the default model out. This scanner reads them all, offline, and can block a merge in CI.

```
node cli.js example --today 2026-10-28
```
```
where                                                         model        shutdown                  move to
example/summarize.py (line 8)                                 gpt-4o-mini  2027-01-14 (in 78 days)   gpt-6-luna
example/support-workflow.json (Support replies > Reply model)  gpt-4.1      2027-01-14 (in 78 days)   gpt-6-luna
example/support-workflow.json (Support replies > Transcribe call)  whisper-1    2027-02-26 (in 121 days)  gpt-transcribe or gpt-live-transcribe

3 finding(s) in 2 files, 2 due within 90 days (registry updated 2026-10-28).
```
(`example/` is in this repo: a Python file and an exported n8n workflow. The transcription node never names its model:
n8n hardcodes `whisper-1` for it.)

## Use it

Needs Node.js 18+. No install, no dependencies, nothing is uploaded.

```
git clone https://github.com/Donrulezz/ai-model-retirement-scanner
node ai-model-retirement-scanner/cli.js .                  # table
node ai-model-retirement-scanner/cli.js . --csv > models.csv
node ai-model-retirement-scanner/cli.js . --within 90      # only what shuts down in the next 90 days
```

| Option | What it does |
|---|---|
| `--within N` | Report only models that shut down within N days (already shut down always shows) |
| `--fail-within N` | Exit with code 1 if anything shuts down within N days |
| `--csv`, `--json` | Machine-readable output |
| `--today YYYY-MM-DD` | Pretend it is another day (for planning) |

It understands gateway and cloud spellings too: `openai/gpt-4o` (OpenRouter), `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
(Bedrock), `claude-sonnet-4-5@20250929` (Vertex), `models/gemini-…` and fine-tunes such as `ft:gpt-4o-mini-2024-07-18:org::id`.

### In CI (GitHub Actions)

```yaml
name: AI model retirement check
on: [pull_request, workflow_dispatch]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: git clone --depth 1 https://github.com/Donrulezz/ai-model-retirement-scanner /tmp/amrs
      - run: node /tmp/amrs/cli.js . --fail-within 60
```

### n8n

Export your workflows (n8n CLI: `n8n export:workflow --all --output=workflows.json`, or Download in the editor) and scan
the file. Nodes that use a default model are reported too: n8n saves a parameter only when it differs from the default,
so `gpt-4o-mini` can be in use without appearing in the JSON.

## Upcoming shutdowns in the registry

`*` = the whole family (every ID that starts with it).

| Date | Provider | Model IDs | Move to |
|---|---|---|---|
| 2026-11-17 | Google | `gemini-3.1-flash-tts-preview`, `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts` | gemini-3.8-flash-tts or gemini-3.8-flash-lite-tts |
| 2026-11-17 | Google | `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-preview-12-2025` | gemini-3.8-live |
| 2026-11-30 | Anthropic | `claude-sonnet-4-5-20250929` | claude-sonnet-5-5 |
| 2026-11-30 | OpenAI | `/v1/prompts` | prompts kept in your own code |
| 2026-11-30 | OpenAI | `/v1/evals` | your own eval runner (OpenAI points to Promptfoo) |
| 2026-12-01 | OpenAI | `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-1.5-2025-12-16`, `chatgpt-image-latest` | gpt-image-2.5-sunburst or gpt-image-2.5-flare |
| 2026-12-11 | OpenAI | `gpt-5-nano`, `gpt-5-nano-2025-08-07` | gpt-5.6-luna |
| 2026-12-11 | OpenAI | `gpt-5`, `gpt-5-2025-08-07`, `o3`, `o3-2025-04-16`, `gpt-5-pro`, `gpt-5-pro-2025-10-06`, `o3-pro`, `o3-pro-2025-06-10` | gpt-5.6-sol |
| 2026-12-11 | OpenAI | `gpt-5-mini`, `gpt-5-mini-2025-08-07` | gpt-5.6-terra |
| 2027-01-06 | OpenAI | `tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`, `gpt-4o-mini-tts-2025-03-20`, `gpt-4o-mini-tts-2025-12-15` | gpt-realtime-2.1-mini |
| 2027-01-14 | OpenAI | `gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`, `gpt-4o-mini-2024-07-18`, `gpt-4.1-2025-04-14`, `gpt-4.1-mini-2025-04-14`, `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-mini` | gpt-6-luna |
| 2027-01-20 | OpenAI | `gpt-4o-mini-transcribe-2025-03-20` | gpt-4o-mini-transcribe-2025-12-15 |
| 2027-01-20 | OpenAI | `gpt-audio`, `gpt-audio-mini-2025-12-15`, `gpt-4o-audio*`, `gpt-4o-mini-audio*` | gpt-audio-1.5 |
| 2027-01-20 | OpenAI | `gpt-realtime`, `gpt-4o-realtime*` | gpt-realtime-2.1 |
| 2027-01-20 | OpenAI | `gpt-realtime-mini-2025-12-15`, `gpt-4o-mini-realtime*` | gpt-realtime-2.1-mini |
| 2027-02-26 | OpenAI | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `gpt-4o-mini-transcribe-2025-12-15`, `gpt-4o-transcribe-diarize` | gpt-transcribe or gpt-live-transcribe |
| 2027-02-26 | OpenAI | `/v1/audio/translations` | v1/realtime/translations |
| 2027-03-15 | Google | `gemini-2.5-flash-image` | gemini-3.1-flash-lite-image |
| 2027-04-01 | OpenAI | `gpt-5.4-nano`, `gpt-5.4-nano-2026-03-17` | gpt-6-luna |
| 2027-04-01 | OpenAI | `gpt-5.3-codex`, `gpt-5.1`, `gpt-5.1-2025-11-13` | gpt-6-sol |

Sources (each entry links its own in `registry.json`):
- https://ai.google.dev/gemini-api/docs/deprecations
- https://developers.openai.com/api/docs/deprecations
- https://platform.claude.com/docs/en/about-claude/model-deprecations

The same scanner runs in the browser at [deadlinefix.com/ai-model-retirement](https://deadlinefix.com/ai-model-retirement)
(paste code or drop an n8n export). Found something missing or a date that moved? Open an issue with the provider's link.

## Tests

```
node test_scanner.js && node test_cli.js
```

MIT licensed. Not affiliated with OpenAI, Anthropic, Google or n8n.
