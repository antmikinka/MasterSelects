type AudioContextWithSinkId = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
type MediaElementWithSinkId = HTMLMediaElement & { setSinkId?: (sinkId: string) => Promise<void> };

type OutputDeviceErrorHandler = (message: string, error: unknown) => void;

export async function applyAudioContextOutputDevice(
  context: AudioContext,
  deviceId: string,
  onError: OutputDeviceErrorHandler,
): Promise<boolean> {
  const routedContext = context as AudioContextWithSinkId;
  if (typeof routedContext.setSinkId !== 'function') return false;
  try {
    await routedContext.setSinkId(deviceId);
    return true;
  } catch (error) {
    onError('Failed to apply AudioContext output device:', error);
    return false;
  }
}

export async function applyMediaElementOutputDevice(
  element: HTMLMediaElement,
  deviceId: string,
  onError: OutputDeviceErrorHandler,
): Promise<boolean> {
  const routedElement = element as MediaElementWithSinkId;
  if (typeof routedElement.setSinkId !== 'function') return false;
  try {
    await routedElement.setSinkId(deviceId);
    return true;
  } catch (error) {
    onError('Failed to apply media output device:', error);
    return false;
  }
}
