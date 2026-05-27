[Back to Features](./README.md)

# Codex Usage Monitoring

MasterSelects includes a local Codex session monitor for answering:

- what the user asked
- how many model calls the turn triggered
- how many input, cached input, output, reasoning, total, and cache-adjusted tokens were reported
- which Git commit and dirty state were observed while the AI worked
- which turns were long-running, open, stale, or unusually expensive

The monitor reads Codex JSONL session logs from `~/.codex/sessions`, filters sessions whose `session_meta.cwd` is inside this repository, and writes local analysis artifacts to `.codex-usage/`.

## Commands

One-shot report:

```bash
npm run codex:usage
```

Continuous watcher:

```bash
npm run codex:usage:watch
```

Stop the hidden watcher started by the desktop launcher:

```bash
npm run codex:usage:stop
```

Generated files:

```text
.codex-usage/turns.jsonl
.codex-usage/turns.deduped.jsonl
.codex-usage/sessions.json
.codex-usage/report.md
.codex-usage/state.json
.codex-usage/watcher.pid
.codex-usage/watcher.out.log
.codex-usage/watcher.err.log
```

`.codex-usage/` is ignored by Git because it contains local conversation metadata.

## Token Model

Codex logs token usage per model call in `event_msg` entries with `payload.type = "token_count"`.

The monitor groups all `last_token_usage` entries after a user message until the next user message or task completion. That grouped sum is the turn cost.

Codex rollout/resume logs can replay older turns into later session files. The monitor keeps raw turns in `turns.jsonl`, marks duplicate replay turns with `dedupe`, and writes representative turns to `turns.deduped.jsonl`. `report.md` uses the deduped data by default and shows the raw inflation separately.

Important fields:

| Field | Meaning |
|---|---|
| `inputTokens` | Full prompt/context tokens sent to the model |
| `cachedInputTokens` | Input tokens served from prompt cache |
| `uncachedInputTokens` | `inputTokens - cachedInputTokens` |
| `outputTokens` | Generated output tokens reported by Codex |
| `reasoningOutputTokens` | Reasoning subset when Codex reports it |
| `visibleOutputTokensEstimate` | `outputTokens - reasoningOutputTokens` |
| `totalTokens` | Reported `inputTokens + outputTokens` |
| `cacheAdjustedTotalTokens` | `totalTokens - cachedInputTokens` |

`reasoningOutputTokens` appears to be included in `outputTokens`, so the monitor does not add it a second time.

## Commit Attribution

The watcher stores Git snapshots in `.codex-usage/state.json`:

- branch
- HEAD commit
- commit subject and timestamp
- dirty status and short status output
- first and last observation time per turn

For future sessions, keep `npm run codex:usage:watch` running while Codex works. That makes commit attribution meaningful across long goals, stale runs, and multiple-hour tasks.

The desktop shortcut `C:\Users\admin\Desktop\masterselects-spalts.lnk` starts `C:\Users\admin\Documents\project-launcher.ps1`, which calls `scripts/start-codex-usage-watch.ps1` when this repository opens. The start script uses `.codex-usage/watcher.pid` to avoid duplicate hidden watcher processes.

For historical sessions parsed after the fact, the monitor can only attach the Git state first observed during report generation. It cannot reconstruct the exact historical HEAD unless the session itself contains enough Git command output.

## Reading The Report

Open `.codex-usage/report.md` after running the command. The most useful tables are:

- `Most Expensive Turns`: sort by total tokens
- `Recent Turns`: chronological review of latest questions
- `Open or stale turns`: visible in the totals for incomplete work

For deeper analysis, load `.codex-usage/turns.jsonl` into a script or spreadsheet and group by `git.lastGit.shortHead`, `status`, `toolUsage.tools`, or question text patterns.
