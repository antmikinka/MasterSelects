import { useState, useMemo, useRef, useEffect } from 'react';
import { useFlashBoardStore } from '../../../stores/flashboardStore';
import {
  useHasFlashBoardActiveGenerationBoard,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import {
  DEFAULT_FLASHBOARD_MODEL_VERSION,
} from '../../../stores/flashboardStore/defaults';
import { useMediaStore } from '../../../stores/mediaStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useAccountStore } from '../../../stores/accountStore';
import {
  SUNO_PROVIDER_ID,
} from '../../../services/sunoService';
import type { CatalogEntry } from '../../../services/flashboard/types';
import { FlashBoardActionStack } from './FlashBoardActionStack';
import { FlashBoardChatControls } from './FlashBoardChatControls';
import { FlashBoardChatOutput } from './FlashBoardChatOutput';
import { FlashBoardElevenLabsSettingsPopovers } from './FlashBoardElevenLabsSettingsPopovers';
import { FlashBoardElevenLabsVoicePopover } from './FlashBoardElevenLabsVoicePopover';
import { buildFlashBoardGenerationActionState } from './FlashBoardGenerationActionStatePlanner';
import { FlashBoardGenerationControls } from './FlashBoardGenerationControls';
import { FlashBoardModelPopover } from './FlashBoardModelPopover';
import {
  buildFlashBoardModelEntryOptions,
  buildFlashBoardModelCatalogState,
  buildFlashBoardModelOptionsState,
  getFlashBoardModelCategory,
  type FlashBoardModelCategoryId,
} from './FlashBoardModelOptionsPlanner';
import { FlashBoardMultishotPanel } from './FlashBoardMultishotPanel';
import {
  MAX_MULTI_SHOTS,
} from './FlashBoardMultishotPlanner';
import { buildFlashBoardParameterOptions } from './FlashBoardParameterOptionsPlanner';
import { FlashBoardParameterPopovers } from './FlashBoardParameterPopovers';
import { FlashBoardPromptEditor } from './FlashBoardPromptEditor';
import { FlashBoardReferenceStrip } from './FlashBoardReferenceStrip';
import { FlashBoardSunoPopovers } from './FlashBoardSunoPopovers';
import { useFlashBoardMultishotController } from './useFlashBoardMultishotController';
import { useFlashBoardComposerPopovers } from './useFlashBoardComposerPopovers';
import { useFlashBoardPromptAutosize } from './useFlashBoardPromptAutosize';
import { useFlashBoardChatHistoryScroll } from './useFlashBoardChatHistoryScroll';
import { useFlashBoardInitialEntrySync } from './useFlashBoardInitialEntrySync';
import { useFlashBoardElevenLabsController } from './useFlashBoardElevenLabsController';
import { useFlashBoardChatController } from './useFlashBoardChatController';
import { useFlashBoardPromptRefineController } from './useFlashBoardPromptRefineController';
import { useFlashBoardGenerationFlowController } from './useFlashBoardGenerationFlowController';
import { useFlashBoardPromptSunoController } from './useFlashBoardPromptSunoController';
import {
  useFlashBoardReferenceController,
  useFlashBoardReferenceValidationController,
} from './useFlashBoardReferenceController';

function normalizeApiKeyValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface FlashBoardComposerProps {
  initialProviderId?: string;
  initialService?: CatalogEntry['service'];
  initialVersion?: string;
  initialMode?: 'generate' | 'chat';
  allowedServices?: CatalogEntry['service'][];
  serviceScope?: CatalogEntry['service'];
}

export function FlashBoardComposer({
  initialProviderId,
  initialService,
  initialVersion,
  initialMode = 'generate',
  allowedServices,
  serviceScope,
}: FlashBoardComposerProps) {
  const hasGenerationBoard = useHasFlashBoardActiveGenerationBoard();
  const composer = useFlashBoardStore((s) => s.composer);
  const updateComposer = useFlashBoardStore((s) => s.updateComposer);
  const setHoveredComposerReference = useFlashBoardStore((s) => s.setHoveredComposerReference);
  const mediaFiles = useMediaStore((s) => s.files);
  const openAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.openai));
  const anthropicApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.anthropic));
  const piApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.piapi));
  const kieAiApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.kieai));
  const evolinkApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.evolink));
  const elevenLabsApiKey = normalizeApiKeyValue(useSettingsStore((s) => s.apiKeys.elevenlabs));
  const apiKeysUnlocked = useSettingsStore((s) => s.apiKeysUnlocked);
  const apiKeyDefaults = useSettingsStore((s) => s.apiKeyDefaults);
  const lemonadeEndpoint = useSettingsStore((s) => s.lemonadeEndpoint);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const aiApprovalMode = useSettingsStore((s) => s.aiApprovalMode);
  const setAiApprovalMode = useSettingsStore((s) => s.setAiApprovalMode);
  const useOpenAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.openai && openAiApiKey.trim());
  const useAnthropicKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.anthropic && anthropicApiKey.trim());
  const usePiApiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.piapi && piApiKey.trim());
  const useKieAiKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.kieai && kieAiApiKey.trim());
  const useEvolinkKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.evolink && evolinkApiKey.trim());
  const useElevenLabsKeyByDefault = Boolean(apiKeysUnlocked && apiKeyDefaults.elevenlabs && elevenLabsApiKey.trim());
  const useHostedProductionProviders = import.meta.env.PROD;
  const hasOpenAiKey = useOpenAiKeyByDefault;
  const hasAnthropicKey = useAnthropicKeyByDefault;
  const hasKieAiKey = useKieAiKeyByDefault;
  const hasEvolinkKey = useEvolinkKeyByDefault;
  const hasElevenLabsKey = useElevenLabsKeyByDefault;
  const accountSession = useAccountStore((s) => s.session);
  const hostedAIEnabled = useAccountStore((s) => s.hostedAIEnabled);
  const openAuthDialog = useAccountStore((s) => s.openAuthDialog);
  const openPricingDialog = useAccountStore((s) => s.openPricingDialog);
  const hasHostedSession = accountSession?.authenticated === true;
  const hasHostedAudioAccess = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseHostedPromptRefiner = Boolean(accountSession?.authenticated && hostedAIEnabled);
  const canUseByoPromptRefiner = !useHostedProductionProviders && hasOpenAiKey;

  const modelCatalogState = useMemo(() => buildFlashBoardModelCatalogState({
    allowedServices,
    hasHostedSession,
    initialProviderId,
    initialService,
    serviceScope,
    useElevenLabsKeyByDefault,
    useEvolinkKeyByDefault,
    useHostedProductionProviders,
    useKieAiKeyByDefault,
    usePiApiKeyByDefault,
  }), [
    allowedServices,
    hasHostedSession,
    initialProviderId,
    initialService,
    serviceScope,
    useElevenLabsKeyByDefault,
    useEvolinkKeyByDefault,
    useHostedProductionProviders,
    useKieAiKeyByDefault,
    usePiApiKeyByDefault,
  ]);
  const {
    emptyCatalogFallbackService,
    initialEntry,
    visibleCatalog,
  } = modelCatalogState;

  const [activeModelCategory, setActiveModelCategory] = useState<FlashBoardModelCategoryId>(() => (
    getFlashBoardModelCategory(initialEntry)
  ));
  const {
    closePopover,
    inlineSubmenuStateClassName,
    popover,
    popoverHostClassName,
    popoverRef,
    renderedPopover,
    togglePopover,
  } = useFlashBoardComposerPopovers();
  const promptRefineCallbacksRef = useRef<{
    clearPromptRefineError: () => void;
    clearPromptRefineState: () => void;
  }>({
    clearPromptRefineError: () => {},
    clearPromptRefineState: () => {},
  });

  const [service, setService] = useState<CatalogEntry['service']>(
    initialEntry?.service ?? visibleCatalog[0]?.service ?? emptyCatalogFallbackService,
  );
  const [providerId, setProviderId] = useState(initialEntry?.providerId ?? visibleCatalog[0]?.providerId ?? initialProviderId ?? '');
  const [version, setVersion] = useState(initialVersion ?? initialEntry?.versions[0] ?? DEFAULT_FLASHBOARD_MODEL_VERSION);
  const [mode, setMode] = useState('std');
  const {
    activeChatModel,
    activeChatModelId,
    chatButtonLabel,
    chatChargeTitle,
    chatError,
    chatMessages,
    chatModelOptions,
    chatPanelOpen,
    chatPrompt,
    chatProvider,
    chatProviderLabel,
    chatProviderOptions,
    chatReasoningEffortOptions,
    chatReasoningSupported,
    chatTemperature,
    chatTemperatureSupported,
    clearChatError,
    copiedChatMessageId,
    handleChatButtonClick,
    handleChatInputKeyDown,
    handleChatMessageDoubleClick,
    handleChatProviderSelect,
    handleChatPromptChange,
    handleClearChatHistory,
    handleClearChatPrompt,
    isChatting,
    lemonadeStatus,
    openAiReasoningEffort,
    setChatModel,
    setChatTemperature,
    setOpenAiReasoningEffort,
    showChatCloudActions,
  } = useFlashBoardChatController({
    anthropicApiKey,
    closePopover,
    hasAnthropicKey,
    hasHostedSession,
    hasOpenAiKey,
    hostedAIEnabled,
    initialMode,
    lemonadeEndpoint,
    openAiApiKey,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    useHostedProductionProviders,
    useOpenAiKeyByDefault,
  });
  const [duration, setDuration] = useState(5);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [imageSize, setImageSize] = useState('1K');
  const [generateAudio, setGenerateAudio] = useState(false);
  useFlashBoardInitialEntrySync({
    initialEntry,
    initialVersion,
    setAspectRatio,
    setDuration,
    setImageSize,
    setMode,
    setProviderId,
    setService,
    setVersion,
  });
  const chatHistoryRef = useFlashBoardChatHistoryScroll({
    chatError,
    chatMessages,
  });

  const modelOptionsState = useMemo(() => buildFlashBoardModelOptionsState({
    activeModelCategory,
    providerId,
    service,
    visibleCatalog,
  }), [
    activeModelCategory,
    providerId,
    service,
    visibleCatalog,
  ]);
  const {
    activeModelEntries,
    availableModelCategories,
    effectiveModelCategory,
    modelButtonLabel,
    selectedEntry,
    selectedModelCategory,
  } = modelOptionsState;
  const isAudioMode = selectedEntry?.outputType === 'audio' || service === 'elevenlabs' || service === 'suno';
  const isSunoMode = selectedEntry?.providerId === SUNO_PROVIDER_ID || service === 'suno';
  const isElevenLabsMode = isAudioMode && !isSunoMode;
  const isHostedAudioMode = isElevenLabsMode && service === 'cloud';
  const {
    hasVideoReferenceInput,
    seedanceReferenceModeActive,
    seedanceReferenceValidationError,
  } = useFlashBoardReferenceValidationController({
    composer,
    mediaFiles,
    providerId,
  });
  const {
    audioModelButtonLabel,
    audioOutputButtonLabel,
    audioVoiceButtonLabel,
    elevenLabsVoicesError,
    handleOutputFormatChange,
    handlePreviewVoice,
    handleRefreshVoices,
    handleSelectVoice,
    handleSpeakerBoostChange,
    handleVoiceSettingNumberChange,
    isLoadingElevenLabsVoices,
    languageCode,
    languageOverride,
    modelMetaText: elevenLabsModelMetaText,
    modelOptions: elevenLabsModelOptions,
    outputFormat,
    outputOptions: elevenLabsOutputOptions,
    resetVoiceSettings,
    selectedModel: selectedElevenLabsModel,
    selectedModelCharacterLimit: selectedElevenLabsCharacterLimit,
    setLanguageCode,
    setLanguageOverride,
    setVoiceId,
    setVoiceName,
    setVoiceSearch,
    voiceId,
    voiceName,
    voiceOptions: elevenLabsVoiceOptions,
    voiceSearch,
    voiceSettings,
    voiceSettingsChanged,
  } = useFlashBoardElevenLabsController({
    elevenLabsApiKey,
    hasElevenLabsKey,
    hasHostedAudioAccess,
    initialLanguageCode: composer.languageCode,
    initialLanguageOverride: composer.languageOverride,
    initialOutputFormat: composer.outputFormat,
    initialVoiceId: composer.voiceId,
    initialVoiceName: composer.voiceName,
    initialVoiceSettings: composer.voiceSettings,
    isElevenLabsMode,
    isHostedAudioMode,
    setVersion,
    version,
  });
  const supportsAudio = !isAudioMode
    && selectedEntry?.supportsGenerateAudio === true
    && !seedanceReferenceModeActive;
  const supportsMultiShot = !isAudioMode && selectedEntry?.supportsMultiShot === true;
  const {
    canAddShot,
    handleAddShot,
    handleMultiShotToggle,
    handleRemoveShot,
    handleShotDurationChange,
    handleShotPromptChange,
    isMultiShotPanelClosing,
    multiShotDurationTotal,
    multiShots,
    normalizedMultiPrompt,
    renderMultiShotPanel,
  } = useFlashBoardMultishotController({
    duration,
    generateAudio,
    isAudioMode,
    selectedEntryOutputType: selectedEntry?.outputType,
    setGenerateAudio,
    supportsAudio,
    supportsMultiShot,
  });
  const {
    currentSunoModelId,
    effectivePrompt,
    handleClearPrompt,
    handlePromptChange,
    handleSunoNegativeTagsChange,
    handleSunoStyleChange,
    handleSunoVocalGenderChange,
    prompt,
    resetSunoTuning,
    setPrompt,
    setSunoAudioWeight,
    setSunoCustomMode,
    setSunoInstrumental,
    setSunoNegativeTags,
    setSunoStyle,
    setSunoStyleWeight,
    setSunoWeirdnessConstraint,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoModelButtonLabel,
    sunoModeButtonLabel,
    sunoModelOptions,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleLimit,
    sunoStyleWeight,
    sunoTitle,
    sunoTuningChanged,
    sunoVocalGender,
    sunoVocalGenderOptions,
    sunoWeirdnessConstraint,
  } = useFlashBoardPromptSunoController({
    composer,
    isSunoMode,
    multiShots,
    normalizedMultiPrompt,
    promptRefineCallbacksRef,
    version,
  });
  const {
    chatInputRef,
    promptInputRef,
    resizePromptInput,
  } = useFlashBoardPromptAutosize({
    chatPanelOpen,
    chatPrompt,
    isAudioMode,
    multiShots,
    prompt,
  });
  const effectiveGenerateAudio = !isAudioMode && supportsAudio && (generateAudio || multiShots);
  const modelEntryOptions = useMemo(() => buildFlashBoardModelEntryOptions({
    activeModelEntries,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    service,
  }), [
    activeModelEntries,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    service,
  ]);
  const {
    audioValidationError,
    backendValidationError,
    canGenerate,
    generateButtonLabel,
    generateButtonTitle,
    multiShotValidationError,
  } = useMemo(() => buildFlashBoardGenerationActionState({
    accountAuthenticated: accountSession?.authenticated === true,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    hasElevenLabsKey,
    hasEvolinkKey,
    hasGenerationBoard,
    hasHostedSession,
    hasKieAiKey,
    hasVideoReferenceInput,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isHostedAudioMode,
    isSunoMode,
    languageCode,
    languageOverride,
    mode,
    maxMultiShots: MAX_MULTI_SHOTS,
    modelRates: selectedElevenLabsModel?.modelRates,
    multiShotDurationTotal,
    multiShots,
    normalizedMultiPrompt,
    providerId,
    selectedElevenLabsCharacterLimit,
    selectedEntry,
    seedanceReferenceValidationError,
    service,
    sunoCustomMode,
    sunoStyle,
    supportsMultiShot,
    usePiApiKeyByDefault,
    version,
    voiceId,
  }), [
    accountSession?.authenticated,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    hasElevenLabsKey,
    hasEvolinkKey,
    hasGenerationBoard,
    hasHostedSession,
    hasKieAiKey,
    hasVideoReferenceInput,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isHostedAudioMode,
    isSunoMode,
    languageCode,
    languageOverride,
    mode,
    multiShotDurationTotal,
    multiShots,
    normalizedMultiPrompt,
    providerId,
    selectedElevenLabsCharacterLimit,
    selectedElevenLabsModel?.modelRates,
    selectedEntry,
    seedanceReferenceValidationError,
    service,
    sunoCustomMode,
    sunoStyle,
    supportsMultiShot,
    usePiApiKeyByDefault,
    version,
    voiceId,
  ]);
  const parameterOptions = useMemo(() => buildFlashBoardParameterOptions({
    activePopover: renderedPopover,
    aspectRatio,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    selectedEntry,
    service,
  }), [
    aspectRatio,
    duration,
    effectiveGenerateAudio,
    hasVideoReferenceInput,
    imageSize,
    mode,
    multiShots,
    providerId,
    renderedPopover,
    selectedEntry,
    service,
  ]);
  const {
    composerReferenceBadges,
    composerStyle,
    effectiveReferenceMediaFileIds,
    getPromptRefineMediaFile,
    handleComposerReferenceRoleChange,
    handleReferenceDragLeave,
    handleReferenceDragOver,
    handleReferenceDrop,
    handleReferenceStripPointerLeave,
    handleRemoveComposerReference,
    isReferenceDragOver,
    maxReferenceMedia,
    referenceStripRef,
    showComposerReferences,
    supportsEndFrameReference,
    supportsTimelineReferenceRoles,
    updateReferenceCardFocus,
  } = useFlashBoardReferenceController({
    composer,
    isAudioMode,
    mediaFiles,
    multiShots,
    selectedEntry,
    setHoveredComposerReference,
    updateComposer,
  });
  const {
    canRestorePrompt,
    clearPromptRefineError,
    clearPromptRefineState,
    handleRefinePrompt,
    handleRestorePromptBeforeAiRewrite,
    isRefiningPrompt,
    promptRefineError,
    promptRefineTitle,
  } = useFlashBoardPromptRefineController({
    aspectRatio,
    canUseByoPromptRefiner,
    canUseHostedPromptRefiner,
    closePopover,
    duration,
    effectiveGenerateAudio,
    getMediaFile: getPromptRefineMediaFile,
    hasHostedSession,
    hostedAIEnabled,
    imageSize,
    isAudioMode,
    isSunoMode,
    mode,
    multiShots,
    openAiApiKey,
    openAuthDialog,
    openPricingDialog,
    openSettings,
    prompt,
    providerId,
    referenceBadges: composerReferenceBadges,
    selectedEntry,
    service,
    setPrompt,
    setSunoCustomMode,
    setSunoNegativeTags,
    setSunoStyle,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    version,
  });
  promptRefineCallbacksRef.current.clearPromptRefineError = clearPromptRefineError;
  promptRefineCallbacksRef.current.clearPromptRefineState = clearPromptRefineState;

  const {
    handleAudioToggle,
    handleGenerate,
    handleKeyDown,
    handleProviderChange,
  } = useFlashBoardGenerationFlowController({
    aspectRatio,
    canGenerate,
    chatPanelOpen,
    closePopover,
    composer,
    duration,
    effectiveGenerateAudio,
    effectivePrompt,
    effectiveReferenceMediaFileIds,
    imageSize,
    isAudioMode,
    isElevenLabsMode,
    isSunoMode,
    languageCode,
    languageOverride,
    maxReferenceMedia,
    mode,
    multiShots,
    normalizedMultiPrompt,
    outputFormat,
    providerId,
    selectedEntry,
    service,
    setAspectRatio,
    setDuration,
    setGenerateAudio,
    setImageSize,
    setMode,
    setProviderId,
    setService,
    setVersion,
    sunoAudioWeight,
    sunoCustomMode,
    sunoInstrumental,
    sunoNegativeTags,
    sunoStyle,
    sunoStyleWeight,
    sunoTitle,
    sunoVocalGender,
    sunoWeirdnessConstraint,
    supportsAudio,
    updateComposer,
    version,
    visibleCatalog,
    voiceId,
    voiceName,
    voiceSettings,
  });

  useEffect(() => {
    if (popover === 'model') {
      setActiveModelCategory(selectedModelCategory);
    }
  }, [popover, selectedModelCategory]);

  if (!hasGenerationBoard) return null;

  const showGenerationCloudActions = Boolean(backendValidationError && service === 'cloud' && /sign in/i.test(backendValidationError));

  return (
    <div
      className={`fb-bubble ${showComposerReferences ? 'has-references' : ''} ${chatPanelOpen ? 'has-chat-panel' : ''} ${isReferenceDragOver ? 'reference-drop-active' : ''} ${isRefiningPrompt ? 'is-refining-prompt' : ''}`}
      style={composerStyle}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onDragOver={handleReferenceDragOver}
      onDragLeave={handleReferenceDragLeave}
      onDrop={handleReferenceDrop}
    >
      {chatPanelOpen && (
        <FlashBoardChatOutput
          chatError={chatError}
          chatHistoryRef={chatHistoryRef}
          copiedChatMessageId={copiedChatMessageId}
          messages={chatMessages}
          showChatCloudActions={showChatCloudActions}
          onAuthClick={openAuthDialog}
          onMessageDoubleClick={handleChatMessageDoubleClick}
          onPricingClick={openPricingDialog}
        />
      )}

      <div className={`fb-bubble-main ${showComposerReferences ? 'has-references' : ''}`}>
        {showComposerReferences && (
          <FlashBoardReferenceStrip
            badges={composerReferenceBadges}
            referenceStripRef={referenceStripRef}
            supportsEndFrameReference={supportsEndFrameReference}
            supportsTimelineReferenceRoles={supportsTimelineReferenceRoles}
            onHoverReference={setHoveredComposerReference}
            onPointerLeave={handleReferenceStripPointerLeave}
            onPointerMove={updateReferenceCardFocus}
            onReferenceRoleChange={handleComposerReferenceRoleChange}
            onRemoveReference={handleRemoveComposerReference}
          />
        )}

        <FlashBoardPromptEditor
          canRestorePrompt={canRestorePrompt}
          chatInputRef={chatInputRef}
          chatPanelOpen={chatPanelOpen}
          chatPrompt={chatPrompt}
          isAudioMode={isAudioMode}
          isRefiningPrompt={isRefiningPrompt}
          isSunoMode={isSunoMode}
          maxReferenceMedia={maxReferenceMedia}
          multiShots={multiShots}
          prompt={prompt}
          promptInputRef={promptInputRef}
          referenceMediaCount={effectiveReferenceMediaFileIds.length}
          sunoNegativeTags={sunoNegativeTags}
          sunoStyle={sunoStyle}
          sunoStyleLimit={sunoStyleLimit}
          onAutosizeInput={resizePromptInput}
          onChatInputKeyDown={handleChatInputKeyDown}
          onChatPromptChange={handleChatPromptChange}
          onClearChatPrompt={handleClearChatPrompt}
          onClearPrompt={handleClearPrompt}
          onPromptChange={handlePromptChange}
          onRestorePromptBeforeAiRewrite={handleRestorePromptBeforeAiRewrite}
          onSunoNegativeTagsChange={handleSunoNegativeTagsChange}
          onSunoStyleChange={handleSunoStyleChange}
        />
      </div>

      {!chatPanelOpen && !isAudioMode && renderMultiShotPanel && (
        <FlashBoardMultishotPanel
          canAddShot={canAddShot}
          duration={duration}
          isClosing={isMultiShotPanelClosing}
          shots={normalizedMultiPrompt}
          totalDuration={multiShotDurationTotal}
          validationError={multiShotValidationError}
          onAddShot={handleAddShot}
          onRemoveShot={handleRemoveShot}
          onShotDurationChange={handleShotDurationChange}
          onShotPromptChange={handleShotPromptChange}
        />
      )}

      {!chatPanelOpen && isAudioMode && audioValidationError && (
        <div className="fb-audio-warning compact">{audioValidationError}</div>
      )}

      {!chatPanelOpen && seedanceReferenceValidationError && (
        <div className="fb-audio-warning compact">{seedanceReferenceValidationError}</div>
      )}

      {!chatPanelOpen && backendValidationError && (
        <div className={`fb-audio-warning compact ${showGenerationCloudActions ? 'has-cloud-actions' : ''}`}>
          <span>{backendValidationError}</span>
          {showGenerationCloudActions && (
            <div className="fb-cloud-warning-actions">
              <button type="button" onClick={openPricingDialog}>
                Prices
              </button>
              <button type="button" onClick={openAuthDialog}>
                Sign in
              </button>
            </div>
          )}
        </div>
      )}

      {!chatPanelOpen && promptRefineError && (
        <div className="fb-audio-warning compact">{promptRefineError}</div>
      )}

      <div className={`fb-bubble-bar ${inlineSubmenuStateClassName}`}>
        {!chatPanelOpen && (
          <FlashBoardGenerationControls
            activePopover={popover}
            aspectRatioLabel={aspectRatio}
            audioModelButtonLabel={audioModelButtonLabel}
            audioOutputButtonLabel={audioOutputButtonLabel}
            audioVoiceButtonLabel={audioVoiceButtonLabel}
            durationLabel={`${duration}s`}
            effectiveGenerateAudio={effectiveGenerateAudio}
            imageSizeLabel={imageSize}
            isAudioMode={isAudioMode}
            isElevenLabsMode={isElevenLabsMode}
            isRefiningPrompt={isRefiningPrompt}
            isSunoMode={isSunoMode}
            modeLabel={mode}
            modelButtonLabel={modelButtonLabel}
            multiShots={multiShots}
            popoverHostClassName={popoverHostClassName}
            popoverRef={popoverRef}
            promptRefineTitle={promptRefineTitle}
            selectedEntryHasAspectRatios={Boolean(selectedEntry && selectedEntry.aspectRatios.length > 0)}
            selectedEntryHasDurations={Boolean(selectedEntry && selectedEntry.durations.length > 0)}
            selectedEntryHasImageSizes={Boolean(selectedEntry?.supportsTextToImage && selectedEntry.imageSizes?.length)}
            selectedEntryHasMultipleModes={Boolean(selectedEntry && selectedEntry.modes.length > 1)}
            sunoModelButtonLabel={sunoModelButtonLabel}
            sunoModeButtonLabel={sunoModeButtonLabel}
            sunoTuningChanged={sunoTuningChanged}
            supportsAudio={supportsAudio}
            supportsMultiShot={supportsMultiShot}
            voiceSettingsChanged={voiceSettingsChanged}
            onAudioToggle={handleAudioToggle}
            onMultiShotToggle={handleMultiShotToggle}
            onOpenPopover={togglePopover}
            onRefinePrompt={handleRefinePrompt}
          >

          <FlashBoardModelPopover
            activeCategoryId={effectiveModelCategory}
            activePopover={renderedPopover}
            categories={availableModelCategories}
            entries={modelEntryOptions}
            onCategoryChange={setActiveModelCategory}
            onEntrySelect={(entryId) => {
              const selectedProvider = modelEntryOptions.find((entry) => entry.id === entryId);
              if (selectedProvider) {
                handleProviderChange(selectedProvider.service, selectedProvider.providerId);
              }
            }}
          />

          <FlashBoardSunoPopovers
            activePopover={renderedPopover}
            audioWeight={sunoAudioWeight}
            currentModelId={currentSunoModelId}
            customMode={sunoCustomMode}
            instrumental={sunoInstrumental}
            isSunoMode={isSunoMode}
            modelOptions={sunoModelOptions}
            styleWeight={sunoStyleWeight}
            vocalGender={sunoVocalGender}
            vocalGenderOptions={sunoVocalGenderOptions}
            weirdnessConstraint={sunoWeirdnessConstraint}
            onAudioWeightChange={setSunoAudioWeight}
            onClosePopover={closePopover}
            onModeChange={(nextCustomMode, nextInstrumental) => {
              setSunoCustomMode(nextCustomMode);
              setSunoInstrumental(nextInstrumental);
            }}
            onModelChange={setVersion}
            onResetTuning={resetSunoTuning}
            onStyleWeightChange={setSunoStyleWeight}
            onVocalGenderChange={handleSunoVocalGenderChange}
            onWeirdnessConstraintChange={setSunoWeirdnessConstraint}
          />

          <FlashBoardElevenLabsSettingsPopovers
            activePopover={renderedPopover}
            isElevenLabsMode={isElevenLabsMode}
            languageCode={languageCode}
            languageOverride={languageOverride}
            modelId={version}
            modelMetaText={elevenLabsModelMetaText}
            modelOptions={elevenLabsModelOptions}
            outputFormat={outputFormat}
            outputOptions={elevenLabsOutputOptions}
            voiceSettings={voiceSettings}
            onLanguageCodeChange={setLanguageCode}
            onLanguageOverrideChange={setLanguageOverride}
            onModelChange={setVersion}
            onOutputFormatChange={handleOutputFormatChange}
            onResetVoiceSettings={resetVoiceSettings}
            onSpeakerBoostChange={handleSpeakerBoostChange}
            onVoiceSettingNumberChange={handleVoiceSettingNumberChange}
          />

          <FlashBoardElevenLabsVoicePopover
            activePopover={renderedPopover}
            emptyMessage={
              isHostedAudioMode
                ? hasHostedAudioAccess ? 'No voices found.' : 'Sign in for Cloud voices.'
                : hasElevenLabsKey ? 'No voices found.' : 'Configure ElevenLabs key.'
            }
            error={elevenLabsVoicesError}
            isElevenLabsMode={isElevenLabsMode}
            isLoading={isLoadingElevenLabsVoices}
            search={voiceSearch}
            selectedVoiceId={voiceId}
            voiceId={voiceId}
            voiceName={voiceName}
            voices={elevenLabsVoiceOptions}
            onPreviewVoice={handlePreviewVoice}
            onRefresh={handleRefreshVoices}
            onSearchChange={setVoiceSearch}
            onSelectVoice={handleSelectVoice}
            onVoiceIdChange={setVoiceId}
            onVoiceNameChange={setVoiceName}
          />

          <FlashBoardParameterPopovers
            activePopover={renderedPopover}
            aspectOptions={parameterOptions.aspectOptions}
            durationOptions={parameterOptions.durationOptions}
            imageSizeOptions={parameterOptions.imageSizeOptions}
            modeOptions={parameterOptions.modeOptions}
            onAspectRatioChange={setAspectRatio}
            onClosePopover={closePopover}
            onDurationChange={setDuration}
            onImageSizeChange={setImageSize}
            onModeChange={setMode}
          />
          </FlashBoardGenerationControls>
        )}

        {chatPanelOpen && (
          <FlashBoardChatControls
            activeChatModel={activeChatModel}
            activeChatModelId={activeChatModelId}
            activePopover={popover}
            aiApprovalMode={aiApprovalMode}
            chatError={chatError}
            chatModelOptions={chatModelOptions}
            chatPrompt={chatPrompt}
            chatProvider={chatProvider}
            chatProviderLabel={chatProviderLabel}
            chatProviderOptions={chatProviderOptions}
            chatReasoningEffortOptions={chatReasoningEffortOptions}
            chatReasoningSupported={chatReasoningSupported}
            chatTemperature={chatTemperature}
            chatTemperatureSupported={chatTemperatureSupported}
            hasChatMessages={chatMessages.length > 0}
            isChatting={isChatting}
            lemonadeStatus={lemonadeStatus}
            openAiReasoningEffort={openAiReasoningEffort}
            popoverHostClassName={popoverHostClassName}
            popoverRef={popoverRef}
            renderedPopover={renderedPopover}
            onAiApprovalModeChange={setAiApprovalMode}
            onChatErrorClear={clearChatError}
            onChatModelChange={setChatModel}
            onChatProviderSelect={handleChatProviderSelect}
            onChatTemperatureChange={setChatTemperature}
            onClearChatHistory={handleClearChatHistory}
            onClosePopover={closePopover}
            onOpenPopover={togglePopover}
            onReasoningEffortChange={setOpenAiReasoningEffort}
          />
        )}

        <FlashBoardActionStack
          canGenerate={canGenerate}
          chatButtonLabel={chatButtonLabel}
          chatButtonTitle={chatChargeTitle ?? 'Send chat prompt'}
          chatPanelOpen={chatPanelOpen}
          generateButtonLabel={generateButtonLabel}
          generateButtonTitle={generateButtonTitle}
          onChatButtonClick={handleChatButtonClick}
          onGenerate={handleGenerate}
        />
      </div>
    </div>
  );
}
