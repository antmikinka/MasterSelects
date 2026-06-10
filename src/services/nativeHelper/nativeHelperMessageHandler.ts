import {
  isCompressed,
  isJpeg,
  parseFrameHeader,
} from './protocol';
import type { Response } from './protocol';
import type {
  DecodedFrame,
  NativeHelperCommandHost,
  NativeHelperJsonMessage,
} from './nativeHelperClientTypes';

type NativeHelperLogger = {
  debug: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
};

export async function handleNativeHelperMessage(
  host: NativeHelperCommandHost,
  data: string | ArrayBuffer,
  log: NativeHelperLogger,
): Promise<void> {
  if (typeof data === 'string') {
    await handleJsonMessage(host, data, log);
    return;
  }

  handleBinaryFrame(host, data, log);
}

async function handleJsonMessage(
  host: NativeHelperCommandHost,
  data: string,
  log: NativeHelperLogger,
): Promise<void> {
  try {
    const message = JSON.parse(data) as NativeHelperJsonMessage;
    if (message.type === 'ai_tool_request') {
      await handleAiToolRequest(host, {
        request_id: message.request_id,
        tool: message.tool,
        args: message.args,
      }, log);
      return;
    }

    if (!message.id) {
      return;
    }

    const isProgress = message.type === 'progress';
    const callback = host.getPendingRequest(message.id);

    if (callback) {
      if (!isProgress) {
        host.deletePendingRequest(message.id);
      }
      callback(message as Response);
    }
  } catch (err) {
    log.error('Failed to parse response', err);
  }
}

function handleBinaryFrame(
  host: NativeHelperCommandHost,
  data: ArrayBuffer,
  log: NativeHelperLogger,
): void {
  const header = parseFrameHeader(data);

  if (!header) {
    log.error('Invalid frame header');
    return;
  }

  const payloadStart = 16;
  const payload = new Uint8Array(data, payloadStart);
  const jpegFrame = isJpeg(header.flags);

  if (!jpegFrame && isCompressed(header.flags)) {
    log.warn('LZ4 decompression not implemented, using raw data');
  }

  const frame: DecodedFrame = {
    width: header.width,
    height: header.height,
    frameNum: header.frameNum,
    data: new Uint8ClampedArray(payload),
    requestId: header.requestId,
    isJpeg: jpegFrame,
  };

  host.dispatchFrame(frame);
}

async function handleAiToolRequest(
  host: NativeHelperCommandHost,
  payload: {
    request_id?: string;
    tool?: string;
    args?: Record<string, unknown>;
  },
  log: NativeHelperLogger,
): Promise<void> {
  const requestId = payload.request_id;
  const tool = payload.tool;

  if (!requestId || !tool) {
    log.warn('Ignoring malformed ai_tool_request from native helper');
    return;
  }

  const commandId = host.nextId();

  try {
    const { executeAITool, AI_TOOLS, getQuickTimelineSummary } = await import('../aiTools');
    let result: unknown;

    if (tool === '_list') {
      result = { success: true, data: AI_TOOLS };
    } else if (tool === '_status') {
      result = { success: true, data: getQuickTimelineSummary() };
    } else {
      result = await executeAITool(tool, payload.args ?? {}, 'nativeHelper');
    }

    await host.send({
      cmd: 'ai_tool_result',
      id: commandId,
      request_id: requestId,
      result,
    });
  } catch (error) {
    try {
      await host.send({
        cmd: 'ai_tool_result',
        id: commandId,
        request_id: requestId,
        result: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } catch (sendError) {
      log.error('Failed to send ai_tool_result error response', sendError);
    }
  }
}
