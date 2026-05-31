# Agent 02 - Media / Import / Storage / Native Audit

## Scope

Media import and supported formats, project persistence/storage, Native Helper, downloads, relinking, proxies, and Media panel/board claims. README and feature docs were compared against the current implementation without editing those docs.

## Sources inspected

- `README.md`
- `docs/Features/Project-Persistence.md`
- `docs/Features/Download-Panel.md`
- `docs/Features/Proxy-System.md`
- `docs/Features/UI-Panels.md`
- `docs/Features/Security.md`
- `tools/native-helper/README.md`
- `src/stores/mediaStore/`
- `src/importers/`
- `src/services/project/`
- `src/services/nativeHelper/`
- `src/services/fileSystemService.ts`
- `src/services/youtubeDownloader.ts`
- `src/stores/mediaDownloadStore.ts`
- `src/components/panels/MediaPanel.tsx`
- `tools/native-helper/src/`

## Confirmed accurate claims

- The README import table mostly matches the legacy media classifier: video, audio, image/SVG, OBJ/glTF/GLB, `.lottie`, `.riv`, content-sniffed Lottie JSON, and gaussian splat formats are recognized in `src/stores/timeline/helpers/mediaTypeHelpers.ts:6-12` and `src/stores/timeline/helpers/mediaTypeHelpers.ts:47-54`. README lines `53-63` also now include ZIP gaussian splat payloads, which matches `GAUSSIAN_SPLAT_EXTENSIONS` at `src/stores/timeline/helpers/mediaTypeHelpers.ts:110`.
- Universal/non-legacy imports are real, not just aspirational. `UniversalImportOrchestrator` first tries concrete Signal importers, then legacy media, then the binary fallback (`src/importers/UniversalImportOrchestrator.ts:74-125`). CSV has a structured importer (`src/importers/providers/csvImporter.ts:24-30`), and unknown files can become binary SignalAssets (`src/importers/providers/binaryFallbackImporter.ts:17-27`).
- File import auto-copy and canonical Raw media behavior are accurately described: `processImport()` copies to Raw when enabled/forced and promotes the project copy as the canonical source (`src/stores/mediaStore/helpers/importPipeline.ts:104-155`), while `RawMediaService.copyToRawFolder()` reuses same-name/same-size files and suffixes conflicts (`src/services/project/domains/RawMediaService.ts:43-90`).
- Native Helper Firefox project storage is implemented as documented: the facade switches to native mode (`src/services/project/ProjectFileService.ts:381-385`), uses Native folder picking with manual path fallback (`src/services/project/ProjectFileService.ts:120-153`), and restores the last native project path from `ms-native-last-project-path` (`src/services/project/core/NativeProjectCoreService.ts:444-467`).
- Native Helper loopback ports, auth, startup token, and scoped filesystem access match Security and helper docs: client connects to `ws://127.0.0.1:9876` and fetches `/startup-token` (`src/services/nativeHelper/NativeHelperClient.ts:180-215`); HTTP fetches inject Bearer auth (`src/services/nativeHelper/NativeHelperClient.ts:1337-1345`); helper defaults to port `9876` and writes a token unless `--no-auth` is used (`tools/native-helper/src/main.rs:37-48`, `tools/native-helper/src/main.rs:139-145`); filesystem commands reject paths outside allowed/granted roots (`tools/native-helper/src/session.rs:116-130`, `tools/native-helper/src/session.rs:550-558`, `tools/native-helper/src/session.rs:639-647`).
- Media panel claims are broadly current: the add menu contains compositions, folders, text, solids, 3D text, cameras, splat effectors, mesh primitives, and Gaussian splat import (`src/components/panels/MediaPanel.tsx:5017-5067`), and project persistence saves/restores board view state (`src/services/project/types/project.types.ts:109-116`, `src/services/project/projectSave.ts:623-643`, `src/services/project/projectLoad.ts:1217-1238`).

## Stale or inaccurate claims with code/file evidence

- README overstates Native Helper decode fallback. `README.md:75` says files with unsupported codecs such as ProRes MOV "fall back to the Native Helper decode path when available," and `README.md:246` says the native helper handles native decode/encode. The code only uses NativeDecoder when both `nativeDecodeEnabled` and `nativeHelperConnected` are true (`src/stores/timeline/clip/addVideoClip.ts:163-173`), and `nativeDecodeEnabled` defaults to `false` (`src/stores/settingsStore.ts:127-130`, `src/stores/settingsStore.ts:286-287`). This is opt-in Turbo decode, not an automatic import/playback fallback.
- Download project-storage docs are only fully true for the FSA backend. `docs/Features/Download-Panel.md:67-68`, `85`, and `140-143` say completed downloads are written to `Downloads/<Platform>/` and duplicate-checked there. `ProjectFileService.saveDownload()`, `checkDownloadExists()`, and `getDownloadFile()` only use `coreService.getProjectHandle()` (`src/services/project/ProjectFileService.ts:863-880`), so native projects have no `Downloads/<Platform>` disk save/reuse path. In native mode, the completed in-memory download is imported with `forceCopyToProject: true` (`src/stores/mediaDownloadStore.ts:225-232`), which routes through native Raw copy support (`src/services/project/ProjectFileService.ts:734-749`) and lands under `Raw/`, while the Media panel folder is still `Downloads/<platform>` (`src/stores/mediaDownloadStore.ts:207-223`).
- Download duplicate detection is narrower than the docs imply. `docs/Features/Download-Panel.md:85` describes an existing-download check, but the active queue only checks existing project files when no `formatId` was requested (`src/stores/mediaDownloadStore.ts:297-304`). The prompt normally requires choosing one recommendation when recommendations exist (`src/components/panels/media/MediaDownloadComposer.tsx:76-81`, `154-158`). `docs/Features/Download-Panel.md:134` correctly notes format-specific re-downloads, but the earlier broad duplicate-detection claim should be qualified.
- Proxy docs are stale on filenames and audio layout. `docs/Features/Proxy-System.md:63-65` and `121-128` say proxy frames are `frame_*.webp` and audio is `audio.m4a`. The current storage service writes proxy frames as `.jpg` by default and accepts old `.webp` reads (`src/services/project/domains/ProxyStorageService.ts:12-15`, `30-31`, `127-139`), and audio proxies are named `<safe-media-id>.wav` (`src/services/project/domains/ProxyStorageService.ts:14-15`, `34-43`; native audio proxy uses `audio/wav` at `src/services/project/ProjectFileService.ts:1023-1056`).
- Proxy docs do not mention native-backend video proxy limitations. `docs/Features/Proxy-System.md:11` and `59` describe project-folder proxy storage generally, but video proxy frame APIs in `ProjectFileService` only use FSA project handles and return/fail when no handle exists (`src/services/project/ProjectFileService.ts:960-999`). Native mode only has special handling for audio proxy save/read/existence (`src/services/project/ProjectFileService.ts:1023-1075`).
- `docs/Features/Project-Persistence.md:79` says the Native Helper has full filesystem access and no permission prompts. That is misleading next to the current helper security model: user-picked paths are granted (`src/services/project/ProjectFileService.ts:122-127`, `150-152`; `tools/native-helper/src/session.rs:254-264`), and file operations enforce allowed roots (`tools/native-helper/src/utils.rs:155-183`, `tools/native-helper/src/session.rs:550-558`). `docs/Features/Security.md:140-145` is the accurate wording.
- UI Panels says "Paste one or more URLs" for Media Downloads (`docs/Features/UI-Panels.md:237-238`), but the current composer queues exactly one URL at a time so a format can be selected (`src/components/panels/media/MediaDownloadComposer.tsx:76-81`, `124-146`).
- Import picker affordances lag behind actual import support. FSA picker defaults only advertise video/audio/image (`src/services/fileSystemService.ts:95-104`), and the hidden fallback input includes legacy media/model/splat extensions but not `.lottie`, `.riv`, `.csv`, or arbitrary Signal/binary imports (`src/components/panels/MediaPanel.tsx:5100-5107`). Drag/drop and programmatic import can still reach the universal importer, but README/docs should avoid implying every import surface exposes every supported format equally.

## Recommended README changes

- Reword `README.md:75` to say Native Helper decode is an optional Turbo decode path requiring the helper, the decode setting, and a resolvable local path. Avoid saying unsupported codecs automatically fall back.
- Reword `README.md:246` from "native decode/encode" to the implemented surface, for example "optional native decode path, Firefox storage backend, AI bridge, and bundled/system yt-dlp downloads"; only mention encode if there is active code evidence outside this audit scope.
- Add a short note near the import table that universal Signal/binary imports exist, but picker affordances may still be narrower than drag/drop/direct import.
- Clarify download storage: FSA projects save helper downloads into `Downloads/<Platform>/`; Native Helper projects currently import completed downloads into project media and Raw storage rather than a native `Downloads/<Platform>` folder.

## Recommended docs/Features changes by file

- `Project-Persistence.md`: Replace "Native Helper has full filesystem access" with "no browser FSA permission prompt; helper grants user-picked paths and enforces allowed roots." Qualify the folder tree so `Downloads/<Platform>/` and video proxy frame storage are FSA-backed today, while native download imports are Raw-backed. Update proxy/audio proxy entries to `.jpg` frames and `AudioProxies/<mediaId>.wav`.
- `Download-Panel.md`: Split FSA and Native project storage behavior. State that title-based existing-download reuse only runs when no explicit `formatId` is selected and currently depends on the FSA project `Downloads/<Platform>/` folder.
- `Proxy-System.md`: Update frame filenames from `.webp` to `.jpg`, audio proxy from `audio.m4a` to `<safe-media-id>.wav`, and add a limitation that native-backend video proxy frame storage is not wired through `ProjectFileService` yet.
- `UI-Panels.md`: Change "Paste one or more URLs" to "Paste one URL at a time" for Media Downloads. The Media Panel add menu and board persistence claims can stay.
- `Security.md`: No material correction found for Native Helper claims; it is more accurate than Project-Persistence on auth/origin/path boundaries.

## Suggested follow-up checks

- Decide whether Native Helper video proxy frame storage should be implemented or the proxy docs should explicitly mark proxies as FSA-only for video frames.
- Verify whether Native Helper encode is active anywhere before keeping the README "native decode/encode" claim.
- Test a Native Helper Firefox project download end to end and confirm the expected on-disk Raw path and Media panel Downloads folder behavior.
- Audit import UX separately: picker accept lists, drag/drop folder import, AI absolute-path import, and Signal fallback should be documented as separate surfaces.
