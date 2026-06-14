import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

export type InterfaceFontFamily = 'system' | 'segoe' | 'arial' | 'verdana' | 'mono';
export type AudioLatencyHint = 'interactive' | 'balanced' | 'playback';

export const DEFAULT_INTERFACE_TEXT_SCALE = 1;
export const MIN_INTERFACE_TEXT_SCALE = 0.9;
export const MAX_INTERFACE_TEXT_SCALE = 1.25;

export function clampInterfaceTextScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_INTERFACE_TEXT_SCALE;
  }
  return Math.min(MAX_INTERFACE_TEXT_SCALE, Math.max(MIN_INTERFACE_TEXT_SCALE, value));
}

interface UiSettingsState {
  interfaceTextScale: number;
  interfaceFontFamily: InterfaceFontFamily;
  highReadabilityMode: boolean;
  audioOutputDeviceId: string;
  audioInputDeviceId: string;
  audioLatencyHint: AudioLatencyHint;
  setInterfaceTextScale: (scale: number) => void;
  setInterfaceFontFamily: (fontFamily: InterfaceFontFamily) => void;
  setHighReadabilityMode: (enabled: boolean) => void;
  setAudioOutputDeviceId: (deviceId: string) => void;
  setAudioInputDeviceId: (deviceId: string) => void;
  setAudioLatencyHint: (hint: AudioLatencyHint) => void;
}

export const useUiSettingsStore = create<UiSettingsState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        interfaceTextScale: DEFAULT_INTERFACE_TEXT_SCALE,
        interfaceFontFamily: 'system',
        highReadabilityMode: false,
        audioOutputDeviceId: '',
        audioInputDeviceId: '',
        audioLatencyHint: 'interactive',
        setInterfaceTextScale: (scale) => set({ interfaceTextScale: clampInterfaceTextScale(scale) }),
        setInterfaceFontFamily: (fontFamily) => set({ interfaceFontFamily: fontFamily }),
        setHighReadabilityMode: (enabled) => set({ highReadabilityMode: enabled }),
        setAudioOutputDeviceId: (deviceId) => set({ audioOutputDeviceId: deviceId }),
        setAudioInputDeviceId: (deviceId) => set({ audioInputDeviceId: deviceId }),
        setAudioLatencyHint: (hint) => set({ audioLatencyHint: hint }),
      }),
      {
        name: 'masterselects-ui-settings',
      },
    ),
  ),
);
