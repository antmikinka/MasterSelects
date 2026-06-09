# Refactor Monitor

Small standalone Electron app for watching a folder while agents edit it.

## Run

```powershell
cd tools/refactor-monitor
npm install
npm start
```

On Windows you can also double-click:

```text
Start Refactor Monitor.cmd
```

## Behavior

- Choose a folder on first launch.
- The last opened folder is restored on the next launch.
- The tree shows folders and files with aggregated LOC and nonblank LOC.
- Click the `Name`, `LOC`, or `Files` headers to sort siblings in ascending or
  descending order.
- Folders can be expanded and collapsed.
- The latest file-system change flashes once; the last three changed paths stay
  visible with fading green strength, and parent folders are marked/expanded.
- The right side shows selection details, largest files, and Git changes.
- File changes trigger a debounced rescan through `fs.watch`.
- Binary and very large files are skipped for LOC counting.

Ignored folders include `.git`, `.wrangler`, `.vite`, `coverage`, `dist`,
`build`, `out`, and `node_modules`.

## CLI Smoke

```powershell
npm run check
```

This scans the MasterSelects repo root and prints a summary.
