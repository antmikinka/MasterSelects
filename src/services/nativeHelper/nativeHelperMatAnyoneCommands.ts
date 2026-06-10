import type {
  Command,
  MatAnyoneMatteResult,
  MatAnyoneStatusResponse,
} from './protocol';
import type {
  NativeHelperCommandHost,
  ProgressLikeResponse,
} from './nativeHelperClientTypes';
import { getErrorMessage, okField } from './nativeHelperResponseUtils';

type ActiveMatAnyoneMatte = {
  id: string;
  timeout: ReturnType<typeof setTimeout>;
  reject: (error: Error) => void;
};

export function createMatAnyoneCommands(host: NativeHelperCommandHost) {
  let activeMatAnyoneMatte: ActiveMatAnyoneMatte | null = null;

  return {
    status: () => matanyoneStatus(host),
    setup: (
      onProgress?: (step: string, percent: number, message: string) => void,
      pythonPath?: string,
    ) => matanyoneSetup(host, onProgress, pythonPath),
    downloadModel: (
      onProgress?: (percent: number, speed?: string, eta?: string) => void,
    ) => matanyoneDownloadModel(host, onProgress),
    start: () => matanyoneStart(host),
    stop: () => matanyoneStop(host),
    matte: (
      videoPath: string,
      maskPath: string,
      outputDir: string,
      options?: { startFrame?: number; endFrame?: number },
      onProgress?: (currentFrame: number, totalFrames: number, percent: number, jobId?: string) => void,
    ) => matanyoneMatte(
      host,
      {
        get active() {
          return activeMatAnyoneMatte;
        },
        set active(value) {
          activeMatAnyoneMatte = value;
        },
      },
      videoPath,
      maskPath,
      outputDir,
      options,
      onProgress,
    ),
    cancel: (jobId: string) => matanyoneCancel(host, {
      get active() {
        return activeMatAnyoneMatte;
      },
      set active(value) {
        activeMatAnyoneMatte = value;
      },
    }, jobId),
    uninstall: () => matanyoneUninstall(host),
  };
}

async function matanyoneStatus(host: NativeHelperCommandHost): Promise<MatAnyoneStatusResponse> {
  const id = host.nextId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      host.deletePendingRequest(id);
      reject(new Error('Request timeout'));
    }, 15000);

    host.registerPendingRequest(id, (response) => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      if (!response.ok) {
        reject(new Error(getErrorMessage(response, 'Failed to get MatAnyone2 status')));
      } else {
        resolve(response as unknown as MatAnyoneStatusResponse);
      }
    });

    host.sendRaw(JSON.stringify({ cmd: 'mat_anyone_status', id })).catch((err) => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      reject(err);
    });
  });
}

async function matanyoneSetup(
  host: NativeHelperCommandHost,
  onProgress?: (step: string, percent: number, message: string) => void,
  pythonPath?: string,
): Promise<{ success: boolean; error?: string }> {
  const id = host.nextId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      host.deletePendingRequest(id);
      reject(new Error('MatAnyone2 setup timeout'));
    }, 600000);

    host.registerPendingRequest(id, (response: ProgressLikeResponse) => {
      if (response.type === 'progress') {
        if (onProgress) {
          onProgress(response.step ?? '', response.percent ?? 0, response.message ?? '');
        }
        return;
      }

      clearTimeout(timeout);
      if (response.ok) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: getErrorMessage(response, 'Setup failed'),
        });
      }
    });

    const cmd: Command = { cmd: 'mat_anyone_setup', id };
    if (pythonPath) {
      cmd.python_path = pythonPath;
    }

    host.sendRaw(JSON.stringify(cmd)).catch((err) => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      reject(err);
    });
  });
}

async function matanyoneDownloadModel(
  host: NativeHelperCommandHost,
  onProgress?: (percent: number, speed?: string, eta?: string) => void,
): Promise<{ success: boolean; error?: string }> {
  const id = host.nextId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      host.deletePendingRequest(id);
      reject(new Error('Model download timeout'));
    }, 600000);

    host.registerPendingRequest(id, (response: ProgressLikeResponse) => {
      if (response.type === 'progress') {
        if (onProgress) {
          onProgress(response.percent ?? 0, response.speed, response.eta);
        }
        return;
      }

      clearTimeout(timeout);
      if (response.ok) {
        resolve({ success: true });
      } else {
        resolve({
          success: false,
          error: getErrorMessage(response, 'Model download failed'),
        });
      }
    });

    host.sendRaw(JSON.stringify({ cmd: 'mat_anyone_download_model', id })).catch((err) => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      reject(err);
    });
  });
}

async function matanyoneStart(host: NativeHelperCommandHost): Promise<{ success: boolean; port?: number }> {
  const id = host.nextId();
  const response = await host.send({ cmd: 'mat_anyone_start', id });

  if (!response.ok) {
    return { success: false };
  }

  return { success: true, port: okField<number>(response, 'port') };
}

async function matanyoneStop(host: NativeHelperCommandHost): Promise<{ success: boolean }> {
  const id = host.nextId();
  const response = await host.send({ cmd: 'mat_anyone_stop', id });
  return { success: response.ok === true };
}

async function matanyoneMatte(
  host: NativeHelperCommandHost,
  state: { active: ActiveMatAnyoneMatte | null },
  videoPath: string,
  maskPath: string,
  outputDir: string,
  options?: { startFrame?: number; endFrame?: number },
  onProgress?: (currentFrame: number, totalFrames: number, percent: number, jobId?: string) => void,
): Promise<MatAnyoneMatteResult> {
  const id = host.nextId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      host.deletePendingRequest(id);
      if (state.active?.id === id) {
        state.active = null;
      }
      reject(new Error('Matting timeout'));
    }, 600000);

    state.active = { id, timeout, reject };

    host.registerPendingRequest(id, (response: ProgressLikeResponse) => {
      if (response.type === 'progress') {
        if (onProgress) {
          onProgress(
            response.current_frame ?? 0,
            response.total_frames ?? 0,
            response.percent ?? 0,
            response.job_id,
          );
        }
        return;
      }

      clearTimeout(timeout);
      if (state.active?.id === id) {
        state.active = null;
      }
      if (response.ok) {
        resolve({
          foreground_path: okField<string>(response, 'foreground_path') ?? '',
          alpha_path: okField<string>(response, 'alpha_path') ?? '',
          job_id: okField<string>(response, 'job_id') ?? '',
        });
      } else {
        reject(new Error(getErrorMessage(response, 'Matting failed')));
      }
    });

    const cmd: Command = {
      cmd: 'mat_anyone_matte',
      id,
      video_path: videoPath,
      mask_path: maskPath,
      output_dir: outputDir,
    };

    if (options?.startFrame !== undefined) {
      cmd.start_frame = options.startFrame;
    }
    if (options?.endFrame !== undefined) {
      cmd.end_frame = options.endFrame;
    }

    host.sendRaw(JSON.stringify(cmd)).catch((err) => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      if (state.active?.id === id) {
        state.active = null;
      }
      reject(err);
    });
  });
}

async function matanyoneCancel(
  host: NativeHelperCommandHost,
  state: { active: ActiveMatAnyoneMatte | null },
  jobId: string,
): Promise<void> {
  const id = host.nextId();
  const response = await host.send({ cmd: 'mat_anyone_cancel', id, job_id: jobId });
  if (!response.ok) {
    throw new Error(getErrorMessage(response, 'Failed to cancel MatAnyone2 job'));
  }

  const active = state.active;
  if (active) {
    clearTimeout(active.timeout);
    host.deletePendingRequest(active.id);
    state.active = null;
    active.reject(new Error('Matte job cancelled'));
  }
}

async function matanyoneUninstall(host: NativeHelperCommandHost): Promise<{ success: boolean }> {
  const id = host.nextId();
  const response = await host.send({ cmd: 'mat_anyone_uninstall', id });
  return { success: response.ok === true };
}
