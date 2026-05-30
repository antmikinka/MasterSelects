# Agent 01 - README / Top-Level Audit

## Scope

Top-level README accuracy against package/build metadata, dependency claims, version/changelog references, project structure, public/index metadata, and locally available dist output. No README or `docs/Features` files were edited.

## Sources inspected

- `README.md`
- `package.json`
- `package-lock.json`
- `src/version.ts`
- `src/changelog-data.json`
- `vite.config.ts`
- `index.html`
- `dist/index.html`
- `dist/assets/*`
- `src/services/aiTools/definitions/*`
- `src/effects/*`
- `src/engine/core/types.ts`
- `src/engine/audio/AudioEffectRegistry.ts`
- top-level `src/`, `tools/`, `public/`, and `dist/` structure

## Confirmed accurate claims

- Version `2.0.6` is consistent across README badge, package metadata, lockfile, app version, changelog title, and built HTML: `README.md:22`, `package.json:4`, `package-lock.json:3`, `package-lock.json:9`, `src/version.ts:3`, `src/version.ts:30`, `src/version.ts:39`, `src/changelog-data.json:5`, `dist/index.html:247`.
- README's `19 direct runtime dependencies` claim is accurate. `package.json:31` starts `dependencies`, and local parsing counted 19 runtime deps plus 22 dev deps. The dependency list named in `README.md:93` matches the runtime dependency surface in `package.json:32-50`.
- README's rounded source-size claims are accurate enough: local count under `src/` found 972 TS/TSX files and 329,895 TS/TSX lines, matching `330k+` wording at `README.md:17` and `README.md:107`; 50 WGSL files and 4,120 WGSL lines match `4.1k+` at `README.md:17`, `README.md:107`, and `README.md:242`.
- README's 33 GPU effects claim is accurate. Static count found 33 `EffectDefinition` exports under `src/effects`; registry assembly is in `src/effects/index.ts:21` and `src/effects/index.ts:65-72`.
- README's 37 blend modes claim is accurate. `src/engine/core/types.ts:7-44` maps blend modes from `normal: 0` through `alpha-add: 36`, and the `BlendMode` union in `src/types/index.ts:117-154` lists the same 37 modes.
- README's 23 Audio FX claim is accurate. `src/engine/audio/AudioEffectRegistry.ts:218-448` defines 23 `audio-*` descriptors, and `src/engine/audio/AudioEffectRegistry.ts:460` builds the registry from them.
- README's `90+ exported` AI tools claim is accurate for source definitions. `src/services/aiTools/definitions/index.ts:21-38` combines 17 definition groups; static count found 92 `name: '<tool>'` entries in those definition files.
- README's `~2 MB compressed editor shell` claim is consistent with existing `dist` output, if interpreted as the editor startup chunk set. `dist/index.html` references `assets/index-DoiTxjYk.js` and `assets/index-sAhEbGRh.css`; the editor path lazy-loads `App-C_F4IZ2C.js`, `index-B46BMoz-.js`, `mp4box-BnHAlVYj.js`, `projectLoad-CdCG2DlG.js`, `App-tQcuOUhN.css`, and `editorBoot-C8ZqHtd3.js`. Local gzip total for those chunks is 1,922,988 bytes. Full `dist/assets` JS/CSS gzip is 2,956,619 bytes, so the README wording should keep saying editor shell/start path rather than total JS/CSS.
- Vite/version replacement details match README development claims: `package.json:12-13`, `vite.config.ts:1152-1156`, `vite.config.ts:1189-1202`.

## Stale or inaccurate claims with code/file evidence

- Public/index AI metadata is stale relative to README and source. README says `90+` tools at `README.md:105`, `README.md:115`, `README.md:146`, `README.md:245`, and `README.md:325`; source definitions count 92 tools. But `index.html:35`, `index.html:149`, `index.html:154`, and `index.html:174` still say 41 tools. Built `dist/index.html:35`, `dist/index.html:151`, `dist/index.html:156`, and `dist/index.html:176` contain the same stale 41-tool metadata.
- Public/index structured metadata still says `WebGPU rendering with 30+ GPU effects` at `index.html:162` and `dist/index.html:164`; README and source support the sharper 33-effect claim (`README.md:16`, `README.md:93`, 33 `EffectDefinition` exports).
- README project structure is missing current top-level `src` directories: actual `src/` includes `artifacts`, `extensions`, `importers`, `marketing`, `routing`, `runtime`, `signals`, `shims`, and `styles`, but the README structure block starts at `README.md:293` and does not list those areas.
- README tools structure omits `tools/visitor-tray`, which exists alongside `ffmpeg-build`, `ffmpeg-wasm-build`, `native-helper`, and `qwen3vl-server`. README lists tools at `README.md:342-347`.
- README structure still lists `src/components/outputManager/` at `README.md:301`, which exists, but it does not mention the newer entry split through `src/RootApp.tsx`, `src/marketing/LandingPage.tsx`, and `src/routing/entryExperience.ts`. This matters because existing `dist/index.html` loads a landing/editor entry split before the editor app.

## Recommended README changes, with exact target sections

- `Project Structure` (`README.md:293-347`): add the current universal-media architecture directories: `artifacts/`, `extensions/`, `importers/`, `runtime/`, `signals/`, plus app-shell directories `marketing/`, `routing/`, `styles/`, and `shims/`. Add `tools/visitor-tray/` or intentionally mark the tools tree as partial.
- `What Makes This Different` startup-footprint paragraph (`README.md:85`): keep the `about 2 MB compressed` wording, but specify it means the editor start path from the current code-split production build, not all JS/CSS or all assets.
- `AI Control` / `What It Does` (`README.md:111-131`, `README.md:146`): README is accurate, but top-level public metadata is not. When README is next touched, update adjacent top-level metadata in `index.html` to avoid contradictory crawler-facing claims.
- `Tech Stack` (`README.md:241-245`): no README correction required for React 19, Vite 7.3, WGSL, or AI tool count.

## Suggested follow-up checks

- Agent owning public/index metadata should update `index.html` AI tool counts from 41 to 92/90+ and `30+ GPU effects` to 33, then rebuild so `dist/index.html` no longer contradicts README.
- Re-run the gzip startup-size check after the next production build; the current evidence used existing `dist` output and did not run `npm run build`.
- If FOSSA/license claims need release-grade confirmation, refresh the external FOSSA report; this audit only verified local npm package metadata and lockfile shape.
