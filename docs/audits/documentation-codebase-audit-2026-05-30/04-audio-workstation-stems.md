# Agent 04 - Audio Workstation / Stems Audit

## Scope

All documented audio capabilities around Audio Focus, waveform/spectrogram artifacts, region/edit-stack operations, Audio Mixer routing, buses/sends/master controls, recording, export audio, audio FX, repair/spectral features, stem separation, and local transcription/audio-analysis interactions.

## Sources inspected

- Docs: `README.md`, `docs/Features/Audio.md`, `docs/Features/Audio-Workstation.md`, `docs/Features/Export.md`, `docs/Features/UI-Panels.md`, `docs/Features/Multicam-AI.md`
- Audio services/engine/UI/store/test areas: `src/services/audio/**`, `src/engine/audio/**`, `src/components/panels/audio-mixer/**`, `src/components/panels/properties/**`, `src/stores/timeline/audioEditSlice.ts`, `src/stores/timeline/stemSeparationSlice.ts`, `src/services/audio/stemSeparation/**`, `src/services/clipTranscriber.ts`, `src/workers/transcriptionWorker.ts`, audio-related unit/store tests

## Confirmed accurate claims

- README's "23 audio FX" claim is current: `AudioEffectId` enumerates 23 IDs and `AUDIO_EFFECT_DESCRIPTORS` has 23 `id: 'audio-*'` entries (`src/engine/audio/AudioEffectRegistry.ts:4`, `src/engine/audio/AudioEffectRegistry.ts:220`).
- Audio Focus / region editing claims are backed by store and timeline code: audio focus/display state exists (`src/stores/timeline/types.ts:693`, `src/stores/timeline/playbackSlice.ts:384`), region gain/edit-stack operations exist (`src/stores/timeline/audioEditSlice.ts:427`, `src/stores/timeline/audioEditSlice.ts:534`), and spectral rectangle/brush selection is implemented in `TimelineClip` (`src/components/timeline/TimelineClip.tsx:1838`, `src/components/timeline/TimelineClip.tsx:1988`).
- Waveform/spectrogram/loudness/beat/onset/frequency/phase artifact claims are supported by timeline generators and Node Workspace projection (`src/stores/timeline/clipSlice.ts:1057`, `src/stores/timeline/clipSlice.ts:1395`, `src/stores/timeline/clipSlice.ts:1539`, `src/stores/timeline/clipSlice.ts:1683`, `src/stores/timeline/clipSlice.ts:1838`, `src/services/nodeGraph/clipGraphProjection.ts:314`, `src/services/nodeGraph/clipGraphProjection.ts:404`).
- Audio Mixer and Properties panel track/master claims are mostly accurate: mixer strips expose record/input, mute/solo, sends, fader, pan, meters, master limiter, preflight, and FX windows (`src/components/panels/audio-mixer/AudioMixerPanel.tsx:272`, `src/components/panels/audio-mixer/AudioMixerPanel.tsx:302`, `src/components/panels/audio-mixer/AudioMixerPanel.tsx:427`, `src/components/panels/audio-mixer/AudioMixerPanel.tsx:451`); Properties switches to `TRACK Controls/Effects/Sends` and `MASTER Controls/Effects` (`src/components/panels/properties/index.tsx:300`, `src/components/panels/properties/index.tsx:324`, `src/components/panels/properties/index.tsx:339`).
- Recording claims are backed by `AudioRecordingService`: AudioWorklet PCM WAV capture, MediaRecorder fallback, recovery storage, punch recording workflow, media import/clip commit, and waveform/loudness job queueing are implemented (`src/services/audio/AudioRecordingService.ts:382`, `src/services/audio/AudioRecordingService.ts:620`, `src/services/audio/AudioRecordingService.ts:1220`, `src/services/audio/AudioRecordingService.ts:1266`, `src/services/audio/timelineRecordingWorkflow.ts:98`).
- Export audio path claims are mostly accurate: `FrameExporter` uses `AudioExportPipeline`, skips audio when no audio is in range, muxes encoded chunks, and standalone audio export supports raw WAV plus browser AAC/Opus (`src/engine/export/FrameExporter.ts:111`, `src/engine/export/FrameExporter.ts:390`, `src/engine/export/FrameExporter.ts:418`, `src/components/export/ExportPanel.tsx:862`, `src/components/export/ExportPanel.tsx:890`). The pipeline renders clip audio through graph/effects, track mix, master effects/fader, target LUFS, limiter/normalization, and sends as master-return entries (`src/engine/audio/AudioExportPipeline.ts:204`, `src/engine/audio/AudioExportPipeline.ts:218`, `src/engine/audio/AudioExportPipeline.ts:550`, `src/engine/audio/AudioExportPipeline.ts:569`, `src/engine/audio/AudioExportPipeline.ts:670`).
- Stem separation is real and tested: model catalog includes production four-stem HTDemucs entries (`src/services/audio/stemSeparation/modelCatalog.ts:8`), the service prepares audio, loads an ONNX worker model, stores stem artifacts, and publishes WAV files to the media library by default (`src/services/audio/stemSeparation/StemSeparationService.ts:300`, `src/services/audio/stemSeparation/StemSeparationService.ts:345`, `src/services/audio/stemSeparation/StemSeparationService.ts:560`, `src/services/audio/stemSeparation/StemSeparationService.ts:666`). Clip source replacement with a stem preserves clip timing/effects/edit state by replacing only source/media/audio-state fields (`src/stores/timeline/stemSeparationSlice.ts:714`).
- Local transcription and audio-analysis interactions are present: local Whisper uses `@huggingface/transformers` in a worker (`src/workers/transcriptionWorker.ts:2`, `src/workers/transcriptionWorker.ts:4`), clip transcription can use local/OpenAI/AssemblyAI/Deepgram providers and persists transcript ranges (`src/services/clipTranscriber.ts:124`, `src/services/clipTranscriber.ts:228`, `src/services/clipTranscriber.ts:452`), and multicam audio sync uses RMS/fingerprints/cross-correlation (`src/services/audioAnalyzer.ts:62`, `src/services/audioSync.ts:153`, `src/services/multicamAnalyzer.ts:186`).

## Stale or inaccurate claims with code/file evidence

- `docs/Features/Audio.md` is stale about spectral status. It says brush editing and full phase-synthesized image resynthesis are still in progress (`docs/Features/Audio.md:182`), but `docs/Features/Audio-Workstation.md` describes them as current (`docs/Features/Audio-Workstation.md:34`) and code/tests confirm brush selection, `spectral-resynthesis`, replace-mode image resynthesis, and phase-continuous silent-bin behavior (`src/components/timeline/TimelineClip.tsx:1988`, `src/components/timeline/TimelineClip.tsx:3887`, `tests/unit/audio/clipAudioRenderService.test.ts:809`, `tests/unit/audio/clipAudioRenderService.test.ts:1020`, `tests/unit/audio/clipAudioRenderService.test.ts:1080`).
- README overstates stem WAV publication as unconditional. It says stem separation "writes Vocals, Drums, Bass, and Other WAV stems back into the project media library" (`README.md:57`, `README.md:91`). The service does publish WAVs by default, but failure is caught and logged while the stem state still returns artifact-backed layers; media-library `mediaFileId`s are only attached when publication succeeds (`src/services/audio/stemSeparation/StemSeparationService.ts:666`, `src/services/audio/stemSeparation/StemSeparationService.ts:683`, `src/services/audio/stemSeparation/StemSeparationService.ts:689`). README should avoid implying this path cannot fall back to artifact-only stems.
- README/docs wording around "buses/sends" can imply full return buses. Current sends are editable and render into the master mix, but dedicated return-bus strips/effect chains are explicitly not complete (`docs/Features/Audio.md:179`). Code models sends with `targetBusId`, gain, pre/post state, and expands them as send-return mix entries into master (`src/engine/audio/AudioGraphRenderer.ts:413`, `src/engine/audio/AudioExportPipeline.ts:670`), not as independently processed return buses.

## Recommended README changes

- Keep the 23-FX, Audio Focus, recording, mixer, export, artifact analysis, and local transcription claims.
- Change the stem sentence to: "Stem separation runs an on-device/browser ONNX path, stores project artifacts, and publishes WAV stems to the media library when the project/media write path succeeds."
- Change "mixer buses/sends" wording to "track sends rendered as master returns; dedicated return-bus effect chains are still future mixer work."

## Recommended docs/Features changes by file

- `docs/Features/Audio.md`: update line 182 status. Brush spectral selection, STFT `spectral-resynthesis`, replace-mode image resynthesis, and phase-continuous silent-bin synthesis should be documented as implemented/tested, not "still in progress."
- `docs/Features/Audio.md`: keep the existing caveat that dedicated return-bus effect chains are future work, and make sure the summary/header does not imply full aux/return buses.
- `docs/Features/Audio-Workstation.md`: mostly aligned with code. Consider adding the stem WAV publication caveat from the README recommendation.
- `docs/Features/Export.md`: audio export section is consistent with code. No required change found.
- `docs/Features/UI-Panels.md`: audio mixer/properties panel claims are consistent with code. No required change found.
- `docs/Features/Multicam-AI.md`: audio RMS/cross-correlation and transcript-sync references are consistent with implementation. No required change found.

## Suggested follow-up checks

- Run targeted tests before changing docs wording: `npm run test -- tests/unit/audio/clipAudioRenderService.test.ts tests/stores/timeline/stemSeparationSlice.test.ts tests/unit/audio/stemSeparationService.test.ts tests/unit/audio/audioExportPreflight.test.ts`.
- Manually verify one browser stem-separation run with project storage available and one forced media-library publish failure, because the README wording depends on observed fallback UX.
- Manually verify whether UI labels say "bus" or "send" in ways that could still imply full aux returns.
