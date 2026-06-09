> Status: Completed archive. This file is kept for historical context and must not be treated as active work unless explicitly reopened.

# Timeline Consensus Team Protocol

Date: 2026-06-07

This folder records the second-pass consensus process for the timeline system
refactor.

## Goal

Two teams independently converge from the first six plans:

- Codex Team reads the three Opus plans first.
- Opus Team reads the three Codex plans first.

Each team iterates through one Markdown memory file in turns. Agents do not edit
the same file concurrently. Each turn must preserve prior notes, add explicit
agreement/disagreement, and move the file closer to a consensus plan.

## Files

- `codex-team-consensus.md`: shared memory for the three Codex agents.
- `opus-team-consensus.md`: shared memory for the three Opus agents.
- `cross-team-final-synthesis.md`: final synthesis after both team files exist.

## Turn Rules

1. Read all assigned source plans and the current team memory file.
2. Do not rewrite history unless a factual claim is wrong.
3. Add a dated turn section with:
   - accepted decisions
   - open disagreements
   - changes to the consensus architecture
   - what the next agent should challenge
4. Keep the final consensus section at the top current after each turn.
5. Only edit your assigned team file.

## Consensus Standard

The output is not "least controversial." It is the most maintainable,
performant, and capable architecture the team can defend. Risk, churn, and
implementation size are not limiting constraints.
