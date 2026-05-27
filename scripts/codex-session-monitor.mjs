#!/usr/bin/env node
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const SCHEMA_VERSION = 1;
const DEFAULT_OUTPUT_DIR = '.codex-usage';
const DEFAULT_POLL_MS = 5000;
const DEFAULT_STALE_MINUTES = 30;
const DEFAULT_ANSWER_PREVIEW_CHARS = 600;
const DEFAULT_QUESTION_PREVIEW_CHARS = 220;

function printUsage() {
  console.log(`Codex session usage monitor

Usage:
  node scripts/codex-session-monitor.mjs once [options]
  node scripts/codex-session-monitor.mjs watch [options]

Options:
  --repo <path>            Project root. Defaults to current working directory.
  --sessions-root <path>   Codex sessions root. Defaults to ~/.codex/sessions.
  --out <path>             Output directory. Defaults to <repo>/.codex-usage.
  --poll-ms <number>       Watch polling interval. Defaults to ${DEFAULT_POLL_MS}.
  --stale-minutes <num>    Mark open turns stale after this many minutes. Defaults to ${DEFAULT_STALE_MINUTES}.
  --include-answer-text    Store full visible assistant text in turns.jsonl.
  --help                   Show this message.

Generated files:
  .codex-usage/turns.jsonl
  .codex-usage/sessions.json
  .codex-usage/report.md
  .codex-usage/state.json
`);
}

function parseArgs(argv) {
  const args = [...argv];
  let command = 'once';
  if (args[0] && !args[0].startsWith('--')) {
    command = args.shift();
  }

  const options = {
    command,
    repoRoot: process.cwd(),
    sessionsRoot: join(os.homedir(), '.codex', 'sessions'),
    outDir: null,
    pollMs: DEFAULT_POLL_MS,
    staleMinutes: DEFAULT_STALE_MINUTES,
    includeAnswerText: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === '--repo') options.repoRoot = next();
    else if (arg === '--sessions-root') options.sessionsRoot = next();
    else if (arg === '--out') options.outDir = next();
    else if (arg === '--poll-ms') options.pollMs = Number(next());
    else if (arg === '--stale-minutes') options.staleMinutes = Number(next());
    else if (arg === '--include-answer-text') options.includeAnswerText = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  options.repoRoot = resolve(options.repoRoot);
  options.sessionsRoot = resolve(options.sessionsRoot);
  options.outDir = resolve(options.outDir ?? join(options.repoRoot, DEFAULT_OUTPUT_DIR));

  if (!Number.isFinite(options.pollMs) || options.pollMs < 1000) {
    throw new Error('--poll-ms must be a number >= 1000');
  }
  if (!Number.isFinite(options.staleMinutes) || options.staleMinutes < 1) {
    throw new Error('--stale-minutes must be a number >= 1');
  }

  return options;
}

function normalizeForCompare(value) {
  return resolve(value).toLowerCase();
}

function isSameOrInside(childPath, parentPath) {
  const child = normalizeForCompare(childPath);
  const parent = normalizeForCompare(parentPath);
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function readFirstJsonLine(filePath) {
  const fd = openSync(filePath, 'r');
  const buffer = Buffer.alloc(2 * 1024 * 1024);

  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const firstLine = text.split(/\r?\n/, 1)[0];
    return safeJsonParse(firstLine);
  } finally {
    closeSync(fd);
  }
}

function listSessionFiles(root) {
  if (!existsSync(root)) return [];
  const results = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  }

  walk(root);
  return results.sort();
}

function getSessionMeta(filePath) {
  const first = readFirstJsonLine(filePath);
  if (first?.type !== 'session_meta' || !first.payload) return null;
  return {
    id: first.payload.id ?? basename(filePath, '.jsonl'),
    startedAt: first.payload.timestamp ?? first.timestamp ?? null,
    cwd: first.payload.cwd ?? null,
    originator: first.payload.originator ?? null,
    cliVersion: first.payload.cli_version ?? null,
    source: first.payload.source ?? null,
    threadSource: first.payload.thread_source ?? null,
    modelProvider: first.payload.model_provider ?? null,
  };
}

function emptyUsage() {
  return {
    modelCalls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    visibleOutputTokensEstimate: 0,
    totalTokens: 0,
    cacheAdjustedTotalTokens: 0,
  };
}

function addUsage(target, usage) {
  const input = Number(usage?.input_tokens ?? 0);
  const cached = Number(usage?.cached_input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? 0);
  const reasoning = Number(usage?.reasoning_output_tokens ?? 0);
  const total = Number(usage?.total_tokens ?? 0);

  target.modelCalls += 1;
  target.inputTokens += input;
  target.cachedInputTokens += cached;
  target.uncachedInputTokens += Math.max(0, input - cached);
  target.outputTokens += output;
  target.reasoningOutputTokens += reasoning;
  target.visibleOutputTokensEstimate += Math.max(0, output - reasoning);
  target.totalTokens += total;
  target.cacheAdjustedTotalTokens += Math.max(0, total - cached);
}

function trimText(value, maxChars) {
  if (!value) return '';
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function extractMessageText(payload) {
  if (typeof payload?.message === 'string') return payload.message;
  if (typeof payload?.text === 'string') return payload.text;
  if (Array.isArray(payload?.content)) {
    return payload.content
      .map((item) => item?.text ?? item?.input_text ?? item?.output_text ?? '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function maybeParseToolName(payload) {
  if (typeof payload?.name === 'string') return payload.name;
  return null;
}

function parseToolExitCode(output) {
  const match = /^Exit code:\s*(-?\d+)/m.exec(String(output ?? ''));
  return match ? Number(match[1]) : null;
}

function createTurn(session, turnIndex, taskIndex, timestamp, question) {
  return {
    schemaVersion: SCHEMA_VERSION,
    turnKey: `${session.id}:turn-${turnIndex}`,
    sessionId: session.id,
    sessionFile: session.file,
    sessionFileName: basename(session.file),
    sessionStartedAt: session.startedAt,
    cwd: session.cwd,
    turnIndex,
    taskIndex,
    questionAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    durationSeconds: 0,
    status: 'open',
    question,
    questionPreview: trimText(question, DEFAULT_QUESTION_PREVIEW_CHARS),
    answerPreview: '',
    assistantPhases: [],
    tokenUsage: emptyUsage(),
    toolUsage: {
      toolCalls: 0,
      toolOutputs: 0,
      failedToolOutputs: 0,
      tools: [],
    },
    parse: {
      parseErrors: 0,
    },
    git: null,
  };
}

function finalizeTurn(turn, options, closureReason) {
  const updatedAt = turn.updatedAt ?? turn.questionAt;
  const hasFinalAnswer = turn.assistantPhases.includes('final_answer');
  if (turn.status === 'open' && hasFinalAnswer) {
    turn.status = 'completed';
  }
  if (turn.status === 'open' && closureReason === 'next_user') {
    turn.status = 'interrupted';
  }
  if (turn.status === 'open') {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    if (ageMs > options.staleMinutes * 60 * 1000) {
      turn.status = 'stale';
    }
  }
  if (turn.completedAt) {
    turn.durationSeconds = secondsBetween(turn.questionAt, turn.completedAt);
  } else {
    turn.durationSeconds = secondsBetween(turn.questionAt, updatedAt);
  }
  if (!options.includeAnswerText) {
    delete turn.answerText;
  }
  return turn;
}

function secondsBetween(start, end) {
  if (!start || !end) return 0;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

async function parseSessionFile(filePath, meta, options) {
  const session = {
    ...meta,
    file: filePath,
    fileSizeBytes: statSync(filePath).size,
    lastWriteTime: statSync(filePath).mtime.toISOString(),
    turns: [],
    tokenUsage: emptyUsage(),
    parseErrors: 0,
    lastEventAt: meta.startedAt,
  };

  const input = createReadStream(filePath, { encoding: 'utf8' });
  const rl = createInterface({ input, crlfDelay: Infinity });
  let currentTurn = null;
  let turnIndex = 0;
  let taskIndex = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const event = safeJsonParse(line);
    if (!event) {
      session.parseErrors += 1;
      if (currentTurn) currentTurn.parse.parseErrors += 1;
      continue;
    }

    const timestamp = event.timestamp ?? session.lastEventAt;
    if (timestamp) {
      session.lastEventAt = timestamp;
    }

    const payload = event.payload ?? {};
    if (event.type === 'event_msg' && payload.type === 'task_started') {
      taskIndex += 1;
      continue;
    }

    if (event.type === 'event_msg' && payload.type === 'user_message') {
      if (currentTurn) {
        session.turns.push(finalizeTurn(currentTurn, options, 'next_user'));
      }
      turnIndex += 1;
      currentTurn = createTurn(session, turnIndex, taskIndex, timestamp, extractMessageText(payload));
      continue;
    }

    if (!currentTurn) continue;
    if (timestamp) currentTurn.updatedAt = timestamp;

    if (event.type === 'event_msg' && payload.type === 'agent_message') {
      const text = extractMessageText(payload);
      const phase = payload.phase ?? 'unknown';
      if (!currentTurn.assistantPhases.includes(phase)) {
        currentTurn.assistantPhases.push(phase);
      }
      currentTurn.answerPreview = trimText(
        [currentTurn.answerPreview, text].filter(Boolean).join('\n'),
        DEFAULT_ANSWER_PREVIEW_CHARS,
      );
      if (options.includeAnswerText) {
        currentTurn.answerText = [currentTurn.answerText, text].filter(Boolean).join('\n\n');
      }
      if (phase === 'final_answer') {
        currentTurn.status = 'completed';
        currentTurn.completedAt = timestamp;
      }
      continue;
    }

    if (event.type === 'event_msg' && payload.type === 'task_complete') {
      currentTurn.status = 'completed';
      currentTurn.completedAt = timestamp;
      continue;
    }

    if (event.type === 'event_msg' && payload.type === 'token_count') {
      const usage = payload.info?.last_token_usage;
      if (usage) {
        addUsage(currentTurn.tokenUsage, usage);
        addUsage(session.tokenUsage, usage);
      }
      continue;
    }

    if (event.type === 'response_item' && payload.type === 'function_call') {
      const toolName = maybeParseToolName(payload);
      currentTurn.toolUsage.toolCalls += 1;
      if (toolName && !currentTurn.toolUsage.tools.includes(toolName)) {
        currentTurn.toolUsage.tools.push(toolName);
      }
      continue;
    }

    if (event.type === 'response_item' && payload.type === 'function_call_output') {
      currentTurn.toolUsage.toolOutputs += 1;
      const exitCode = parseToolExitCode(payload.output);
      if (exitCode !== null && exitCode !== 0) {
        currentTurn.toolUsage.failedToolOutputs += 1;
      }
    }
  }

  if (currentTurn) {
    session.turns.push(finalizeTurn(currentTurn, options, 'end_of_file'));
  }

  return session;
}

function runGit(args, repoRoot) {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function getGitSnapshot(repoRoot) {
  const head = runGit(['rev-parse', 'HEAD'], repoRoot);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const statusShort = runGit(['status', '--short'], repoRoot);
  const commitTime = runGit(['log', '-1', '--format=%cI'], repoRoot);
  const subject = runGit(['log', '-1', '--format=%s'], repoRoot);
  return {
    observedAt: new Date().toISOString(),
    repoRoot,
    branch: branch || null,
    head: head || null,
    shortHead: head ? head.slice(0, 8) : null,
    commitTime: commitTime || null,
    subject: subject || null,
    dirty: Boolean(statusShort),
    statusShort,
  };
}

function loadState(outDir, repoRoot) {
  const statePath = join(outDir, 'state.json');
  if (!existsSync(statePath)) {
    return {
      schemaVersion: SCHEMA_VERSION,
      repoRoot,
      turns: {},
    };
  }

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (!state.turns) state.turns = {};
    return state;
  } catch {
    return {
      schemaVersion: SCHEMA_VERSION,
      repoRoot,
      turns: {},
    };
  }
}

function attachGitSnapshots(turns, state, gitSnapshot) {
  for (const turn of turns) {
    const existing = state.turns[turn.turnKey];
    const tokenTotal = turn.tokenUsage.totalTokens;
    if (!existing) {
      state.turns[turn.turnKey] = {
        firstObservedAt: gitSnapshot.observedAt,
        lastObservedAt: gitSnapshot.observedAt,
        firstGit: gitSnapshot,
        lastGit: gitSnapshot,
        lastTokenTotal: tokenTotal,
        lastStatus: turn.status,
      };
    } else if (existing.lastTokenTotal !== tokenTotal || existing.lastStatus !== turn.status) {
      existing.lastObservedAt = gitSnapshot.observedAt;
      existing.lastGit = gitSnapshot;
      existing.lastTokenTotal = tokenTotal;
      existing.lastStatus = turn.status;
    }

    const turnState = state.turns[turn.turnKey];
    turn.git = {
      firstObservedAt: turnState.firstObservedAt,
      lastObservedAt: turnState.lastObservedAt,
      firstGit: turnState.firstGit,
      lastGit: turnState.lastGit,
      accuracy: 'exact while watcher was running; approximate for already-finished historical turns',
    };
  }
}

function sumUsage(turns) {
  const usage = emptyUsage();
  for (const turn of turns) {
    usage.modelCalls += turn.tokenUsage.modelCalls;
    usage.inputTokens += turn.tokenUsage.inputTokens;
    usage.cachedInputTokens += turn.tokenUsage.cachedInputTokens;
    usage.uncachedInputTokens += turn.tokenUsage.uncachedInputTokens;
    usage.outputTokens += turn.tokenUsage.outputTokens;
    usage.reasoningOutputTokens += turn.tokenUsage.reasoningOutputTokens;
    usage.visibleOutputTokensEstimate += turn.tokenUsage.visibleOutputTokensEstimate;
    usage.totalTokens += turn.tokenUsage.totalTokens;
    usage.cacheAdjustedTotalTokens += turn.tokenUsage.cacheAdjustedTotalTokens;
  }
  return usage;
}

function createDedupeKey(turn) {
  return [
    turn.question,
    turn.answerPreview,
    turn.tokenUsage.modelCalls,
    turn.tokenUsage.totalTokens,
    turn.tokenUsage.outputTokens,
    turn.tokenUsage.reasoningOutputTokens,
  ].join('\u0001');
}

function representativeScore(turn) {
  const statusScore = turn.status === 'completed' ? 4 : turn.status === 'interrupted' ? 3 : turn.status === 'stale' ? 2 : 1;
  return (
    turn.toolUsage.toolCalls * 1_000_000_000 +
    turn.toolUsage.toolOutputs * 1_000_000 +
    turn.durationSeconds * 1_000 +
    statusScore
  );
}

function markDuplicateTurns(turns) {
  const groups = new Map();
  for (const turn of turns) {
    const key = createDedupeKey(turn);
    const group = groups.get(key) ?? [];
    group.push(turn);
    groups.set(key, group);
  }

  const dedupedTurns = [];
  let duplicateTurnCount = 0;
  let duplicateAdjustedTokens = 0;
  let duplicateOutputTokens = 0;

  for (const [key, group] of groups.entries()) {
    group.sort((a, b) => {
      const scoreDelta = representativeScore(b) - representativeScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      return new Date(a.sessionStartedAt ?? a.questionAt).getTime() - new Date(b.sessionStartedAt ?? b.questionAt).getTime();
    });

    const representative = group[0];
    representative.dedupe = {
      key,
      representative: true,
      duplicateOf: null,
      duplicateCount: group.length,
      duplicateIndex: 0,
    };
    dedupedTurns.push(representative);

    for (let index = 1; index < group.length; index += 1) {
      const duplicate = group[index];
      duplicate.dedupe = {
        key,
        representative: false,
        duplicateOf: representative.turnKey,
        duplicateCount: group.length,
        duplicateIndex: index,
      };
      duplicateTurnCount += 1;
      duplicateAdjustedTokens += duplicate.tokenUsage.cacheAdjustedTotalTokens;
      duplicateOutputTokens += duplicate.tokenUsage.outputTokens;
    }
  }

  dedupedTurns.sort((a, b) => new Date(a.questionAt).getTime() - new Date(b.questionAt).getTime());

  return {
    rawTurns: turns,
    dedupedTurns,
    duplicateSummary: {
      rawTurnCount: turns.length,
      dedupedTurnCount: dedupedTurns.length,
      duplicateTurnCount,
      duplicateGroupCount: [...groups.values()].filter((group) => group.length > 1).length,
      duplicateAdjustedTokens,
      duplicateOutputTokens,
    },
  };
}

function markdownEscape(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value ?? 0);
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function renderReport({ repoRoot, sessions, turns, rawTurns, usage, rawUsage, duplicateSummary, gitSnapshot }) {
  const generatedAt = new Date().toISOString();
  const topTurns = [...turns]
    .sort((a, b) => b.tokenUsage.totalTokens - a.tokenUsage.totalTokens)
    .slice(0, 25);
  const recentTurns = [...turns]
    .sort((a, b) => new Date(b.questionAt).getTime() - new Date(a.questionAt).getTime())
    .slice(0, 25);
  const openTurns = turns.filter((turn) => turn.status === 'open' || turn.status === 'stale');
  const duplicateAdjustedPercent = rawUsage.cacheAdjustedTotalTokens
    ? (duplicateSummary.duplicateAdjustedTokens / rawUsage.cacheAdjustedTotalTokens) * 100
    : 0;

  const topRows = topTurns.map((turn) => [
    turn.questionAt,
    turn.status,
    turn.git?.lastGit?.shortHead ?? '',
    formatNumber(turn.tokenUsage.outputTokens),
    formatNumber(turn.tokenUsage.reasoningOutputTokens),
    formatNumber(turn.tokenUsage.totalTokens),
    formatNumber(turn.tokenUsage.cacheAdjustedTotalTokens),
    formatDuration(turn.durationSeconds),
    markdownEscape(turn.questionPreview),
  ]);

  const recentRows = recentTurns.map((turn) => [
    turn.questionAt,
    turn.status,
    turn.git?.lastGit?.shortHead ?? '',
    formatNumber(turn.tokenUsage.outputTokens),
    formatNumber(turn.tokenUsage.totalTokens),
    formatDuration(turn.durationSeconds),
    markdownEscape(turn.questionPreview),
  ]);

  return `# Codex Usage Report

Generated at: ${generatedAt}

Repo: \`${repoRoot}\`
Current Git: \`${gitSnapshot.shortHead ?? 'unknown'}\` on \`${gitSnapshot.branch ?? 'unknown'}\`${gitSnapshot.dirty ? ' (dirty)' : ''}

## Totals

| Metric | Value |
|---|---:|
| Sessions | ${formatNumber(sessions.length)} |
| User turns, deduped | ${formatNumber(turns.length)} |
| User turns, raw | ${formatNumber(rawTurns.length)} |
| Duplicate replay turns | ${formatNumber(duplicateSummary.duplicateTurnCount)} |
| Duplicate replay groups | ${formatNumber(duplicateSummary.duplicateGroupCount)} |
| Open or stale turns | ${formatNumber(openTurns.length)} |
| Model calls | ${formatNumber(usage.modelCalls)} |
| Input tokens | ${formatNumber(usage.inputTokens)} |
| Cached input tokens | ${formatNumber(usage.cachedInputTokens)} |
| Uncached input tokens | ${formatNumber(usage.uncachedInputTokens)} |
| Output tokens | ${formatNumber(usage.outputTokens)} |
| Reasoning output tokens | ${formatNumber(usage.reasoningOutputTokens)} |
| Visible output estimate | ${formatNumber(usage.visibleOutputTokensEstimate)} |
| Total tokens | ${formatNumber(usage.totalTokens)} |
| Cache-adjusted total | ${formatNumber(usage.cacheAdjustedTotalTokens)} |
| Raw cache-adjusted total | ${formatNumber(rawUsage.cacheAdjustedTotalTokens)} |
| Duplicate cache-adjusted inflation | ${formatNumber(duplicateSummary.duplicateAdjustedTokens)} (${duplicateAdjustedPercent.toFixed(1)}%) |

## Most Expensive Turns

| Asked at | Status | Commit | Output | Reasoning | Total | Cache-adjusted | Duration | Question |
|---|---|---|---:|---:|---:|---:|---:|---|
${topRows.map((row) => `| ${row.join(' | ')} |`).join('\n') || '| | | | | | | | | |'}

## Recent Turns

| Asked at | Status | Commit | Output | Total | Duration | Question |
|---|---|---|---:|---:|---:|---|
${recentRows.map((row) => `| ${row.join(' | ')} |`).join('\n') || '| | | | | | | |'}

## Notes

- Token rows use Codex \`last_token_usage\` events. A user turn cost is the sum of all model calls after that user message until the next user message or task completion.
- Tables use deduped turns. Raw turns are still written to \`.codex-usage/turns.jsonl\`; deduped representatives are written to \`.codex-usage/turns.deduped.jsonl\`.
- \`outputTokens\` is the generated output total reported by Codex. \`reasoningOutputTokens\` is tracked separately when present and appears to be included in output totals, so it is not added again.
- Commit attribution is exact only for turns observed while \`codex:usage:watch\` was running. Historical turns are attached to the Git state first observed during report generation.
`;
}

function writeJson(pathName, data) {
  writeFileSync(pathName, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function writeJsonl(pathName, rows) {
  writeFileSync(pathName, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

async function collect(options) {
  const sessionFiles = listSessionFiles(options.sessionsRoot);
  const projectSessions = [];

  for (const filePath of sessionFiles) {
    const meta = getSessionMeta(filePath);
    if (!meta?.cwd) continue;
    if (!isSameOrInside(meta.cwd, options.repoRoot)) continue;
    projectSessions.push(await parseSessionFile(filePath, meta, options));
  }

  const rawTurns = projectSessions.flatMap((session) => session.turns);
  rawTurns.sort((a, b) => new Date(a.questionAt).getTime() - new Date(b.questionAt).getTime());

  const gitSnapshot = getGitSnapshot(options.repoRoot);
  mkdirSync(options.outDir, { recursive: true });
  const state = loadState(options.outDir, options.repoRoot);
  attachGitSnapshots(rawTurns, state, gitSnapshot);
  const { dedupedTurns, duplicateSummary } = markDuplicateTurns(rawTurns);

  const rawUsage = sumUsage(rawTurns);
  const usage = sumUsage(dedupedTurns);
  const sessions = projectSessions.map((session) => ({
    schemaVersion: SCHEMA_VERSION,
    sessionId: session.id,
    sessionFile: session.file,
    sessionFileName: basename(session.file),
    sessionRelativeFile: relative(options.sessionsRoot, session.file),
    startedAt: session.startedAt,
    lastEventAt: session.lastEventAt,
    cwd: session.cwd,
    originator: session.originator,
    cliVersion: session.cliVersion,
    source: session.source,
    threadSource: session.threadSource,
    modelProvider: session.modelProvider,
    fileSizeBytes: session.fileSizeBytes,
    lastWriteTime: session.lastWriteTime,
    turnCount: session.turns.length,
    tokenUsage: session.tokenUsage,
    parseErrors: session.parseErrors,
  }));

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
    sessionsRoot: options.sessionsRoot,
    outDir: options.outDir,
    sessions,
    rawTurns,
    turns: dedupedTurns,
    usage,
    rawUsage,
    duplicateSummary,
    state,
    gitSnapshot,
  };
}

async function runOnce(options) {
  const result = await collect(options);
  writeJsonl(join(options.outDir, 'turns.jsonl'), result.rawTurns);
  writeJsonl(join(options.outDir, 'turns.deduped.jsonl'), result.turns);
  writeJson(join(options.outDir, 'sessions.json'), {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: result.generatedAt,
    repoRoot: result.repoRoot,
    sessionsRoot: result.sessionsRoot,
    git: result.gitSnapshot,
    totalUsage: result.usage,
    rawTotalUsage: result.rawUsage,
    duplicateSummary: result.duplicateSummary,
    sessions: result.sessions,
  });
  writeJson(join(options.outDir, 'state.json'), result.state);
  writeFileSync(join(options.outDir, 'report.md'), renderReport(result), 'utf8');
  return result;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function runWatch(options) {
  console.log(`Watching Codex sessions in ${options.sessionsRoot}`);
  console.log(`Project filter: ${options.repoRoot}`);
  console.log(`Output: ${options.outDir}`);
  let stopped = false;
  process.on('SIGINT', () => {
    stopped = true;
  });
  process.on('SIGTERM', () => {
    stopped = true;
  });

  while (!stopped) {
    try {
      const result = await runOnce(options);
      console.log(
        `[${result.generatedAt}] sessions=${result.sessions.length} turns=${result.turns.length} total=${result.usage.totalTokens} output=${result.usage.outputTokens}`,
      );
    } catch (error) {
      console.error(`[${new Date().toISOString()}] monitor error: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(options.pollMs);
  }
  console.log('Codex usage watcher stopped.');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (options.command !== 'once' && options.command !== 'watch') {
    throw new Error(`Unknown command: ${options.command}`);
  }

  if (options.command === 'watch') {
    await runWatch(options);
    return;
  }

  const result = await runOnce(options);
  console.log(`Wrote Codex usage report to ${join(options.outDir, 'report.md')}`);
  console.log(`Sessions: ${result.sessions.length}`);
  console.log(`Turns: ${result.turns.length}`);
  console.log(`Total tokens: ${result.usage.totalTokens}`);
  console.log(`Output tokens: ${result.usage.outputTokens}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
