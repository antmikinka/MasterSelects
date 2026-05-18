export type AudioOnlyExportFormat = 'wav' | 'browser';

export type WavBitDepth = 16;

export interface AudioBufferLike {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

export interface WavEncodeOptions {
  bitDepth?: WavBitDepth;
}

const WAV_HEADER_BYTES = 44;
const WAV_FORMAT_PCM = 1;

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function floatToPcm16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
  return clamped < 0
    ? Math.round(clamped * 0x8000)
    : Math.round(clamped * 0x7fff);
}

export function estimateWavByteSize(buffer: AudioBufferLike, options?: WavEncodeOptions): number {
  const bitDepth = options?.bitDepth ?? 16;
  const bytesPerSample = bitDepth / 8;
  return WAV_HEADER_BYTES + buffer.length * buffer.numberOfChannels * bytesPerSample;
}

export function encodeAudioBufferToWavBytes(buffer: AudioBufferLike, options?: WavEncodeOptions): Uint8Array {
  const bitDepth = options?.bitDepth ?? 16;
  if (bitDepth !== 16) {
    throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
  }

  const channelCount = Math.floor(buffer.numberOfChannels);
  if (!Number.isFinite(buffer.sampleRate) || buffer.sampleRate <= 0) {
    throw new Error('Cannot encode WAV with an invalid sample rate');
  }
  if (!Number.isFinite(channelCount) || channelCount < 1) {
    throw new Error('Cannot encode WAV without audio channels');
  }
  if (!Number.isFinite(buffer.length) || buffer.length < 0) {
    throw new Error('Cannot encode WAV with an invalid sample count');
  }

  const sampleCount = Math.floor(buffer.length);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = sampleCount * blockAlign;
  const fileSize = WAV_HEADER_BYTES + dataSize;
  const riffChunkSize = fileSize - 8;

  if (riffChunkSize > 0xffffffff) {
    throw new Error('WAV export is limited to 4 GB RIFF files');
  }

  const bytes = new Uint8Array(fileSize);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, riffChunkSize, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, WAV_FORMAT_PCM, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, Math.round(buffer.sampleRate), true);
  view.setUint32(28, Math.round(buffer.sampleRate) * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData = Array.from({ length: channelCount }, (_, channel) => buffer.getChannelData(channel));
  let offset = WAV_HEADER_BYTES;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const pcm = floatToPcm16(channelData[channel]?.[sampleIndex] ?? 0);
      view.setInt16(offset, pcm, true);
      offset += bytesPerSample;
    }
  }

  return bytes;
}

export function encodeAudioBufferToWavBlob(buffer: AudioBufferLike, options?: WavEncodeOptions): Blob {
  const bytes = encodeAudioBufferToWavBytes(buffer, options);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
