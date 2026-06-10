import { Logger } from '../../../services/logger';
import { SplatRenderTargetPool } from './SplatRenderTargetPool';
import { SplatVisibilityPass } from './SplatVisibilityPass';
import { SplatSortPass } from './SplatSortPass';
import { SplatOrderSorter } from './SplatOrderSorter.ts';
import { ParticleCompute } from '../effects/ParticleCompute';
import { EffectorCompute } from '../../native3d/passes/EffectorCompute';
import type { SceneSplatEffectorRuntimeData } from '../../scene/types';
import type { GaussianSplatParticleSettings, GaussianSplatTemporalSettings } from '../types';
import {
  createSplatRenderPipelines,
  selectSplatRenderPipeline,
  type SplatRenderPipelineBundle,
} from './splatRenderer/pipelines';
import {
  createSplatCameraUniformResource,
  writeSplatCameraUniforms,
  type SplatCameraUniformResource,
} from './splatRenderer/cameraUniforms';
import {
  createIdentityIndexBuffer,
  createSplatDataBindGroup,
  createSplatDataBuffer,
  getExpectedSplatFloatCount,
  getOrCreateEffectorStorageBuffer,
  getOrCreateParticleStorageBuffer,
  getSplatBufferByteSize,
  isUploadableSplatDataValid,
  releaseEffectorStorageBuffer,
  releaseParticleStorageBuffer,
  type SplatStorageBufferResource,
} from './splatRenderer/sceneUpload';
import {
  buildSplatRenderPassDescriptor,
  CULL_THRESHOLD,
  prepareSplatRenderParams,
  SORT_THRESHOLD,
} from './splatRenderer/renderParams';
import { updateGpuSortFrame, updateWorkerSortFrame } from './splatRenderer/sortGlue';
import {
  buildRenderTargetReadbackLayout,
  summarizeRenderTargetPixels,
} from './splatRenderer/renderTargetSummary';
import { resolveSplatRenderTarget } from './splatRenderer/renderTargets';
import { recordSplatRenderDebug } from './splatRenderer/debugSnapshots';

const log = Logger.create('GaussianSplatGpuRenderer');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UploadableSplatData {
  splatCount: number;
  /** Canonical Float32Array: 14 floats per splat
   *  [x,y,z, sx,sy,sz, rw,rx,ry,rz, r,g,b, opacity] */
  data: Float32Array;
}

export interface SplatCameraParams {
  viewMatrix: Float32Array;       // 4x4 column-major
  projectionMatrix: Float32Array; // 4x4 column-major
  viewport: { width: number; height: number };
  fov: number;
  near: number;
  far: number;
}

interface SplatSceneGpuResources {
  splatBuffer: GPUBuffer;
  splatCount: number;
  /** Identity index buffer: [0, 1, 2, ..., splatCount-1] */
  identityIndexBuffer: GPUBuffer;
  /** Bind group for the render pipeline (splatData + identityIndices) */
  bindGroup: GPUBindGroup;
  /** Frame counter for sort frequency throttling */
  framesSinceSort: number;
  /** Cached sorted bind group — reused between sort frames */
  sortedBindGroup: GPUBindGroup | null;
  workerSorter: SplatOrderSorter | null;
  workerSortedBindGroup: GPUBindGroup | null;
  activeWorkerSortedBindGroup: {
    dataBuffer: GPUBuffer;
    orderBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
  } | null;
}

export interface GaussianSplatRenderDebugSnapshot {
  clipId: string;
  sceneSplatCount: number;
  activeSplatCount: number;
  effectiveSplatCount: number;
  drawCount: number;
  viewport: { width: number; height: number };
  backgroundColor?: string;
  usedCull: boolean;
  usedSort: boolean;
}

export interface GaussianSplatRenderTargetSummary {
  width: number;
  height: number;
  centerPixel: [number, number, number, number];
  nonTransparentSampled: number;
  nonBlackSampled: number;
}

/** Optional parameters for temporal + particle pipeline steps */
export interface SplatRenderOptions {
  /** Clip-local time in seconds (for particle effects) */
  clipLocalTime?: number;
  /** Clear color for the render target. Use "transparent" to preserve alpha. */
  backgroundColor?: string;
  /** Render into an existing color attachment instead of an internal pooled target. */
  outputView?: GPUTextureView;
  /** Color load operation for the target render pass. */
  colorLoadOp?: GPULoadOp;
  /** Optional shared scene depth attachment. */
  depthView?: GPUTextureView;
  /** Whether splat fragments should update the shared depth attachment. */
  depthWrite?: boolean;
  /** Whether the splat pass writes color; false is used for depth-mask-only passes. */
  colorWrite?: boolean;
  /** Depth load operation for the render pass. */
  depthLoadOp?: GPULoadOp;
  /** Depth store operation for the render pass. */
  depthStoreOp?: GPUStoreOp;
  /** Depth clear value used when depthLoadOp is 'clear'. */
  depthClearValue?: number;
  /** Optional per-layer world transform for shared-scene rendering. */
  worldMatrix?: Float32Array;
  /** Layer opacity multiplier applied before premultiplied-alpha output. */
  layerOpacity?: number;
  /** Fragment alpha cutoff for depth-mask passes. Color passes should leave this at the default. */
  depthAlphaCutoff?: number;
  /** Object-level 3D effectors in shared scene space. */
  effectors?: SceneSplatEffectorRuntimeData[];
  /** Max splat budget (0 = unlimited) */
  maxSplats?: number;
  /** Particle effect settings */
  particleSettings?: GaussianSplatParticleSettings;
  /** Sort every N frames (1 = every frame, 0 = never) */
  sortFrequency?: number;
  /** Temporal playback settings (informational — frame switching handled externally via uploadScene) */
  temporalSettings?: GaussianSplatTemporalSettings;
  /** Prefer correctness over throughput (used for offline export). */
  precise?: boolean;
}

// ── Performance thresholds ────────────────────────────────────────────────────
// ── Renderer Class ────────────────────────────────────────────────────────────

export class GaussianSplatGpuRenderer {
  private device: GPUDevice | null = null;
  private pipelines: SplatRenderPipelineBundle | null = null;
  private sceneCache: Map<string, SplatSceneGpuResources> = new Map();
  private cameraUniformPool: SplatCameraUniformResource[] = [];
  private cameraUniformCursor = 0;
  private renderTargetPool!: SplatRenderTargetPool;
  private _initialized = false;

  // Wave 5: Particle compute subsystem
  private effectorCompute: EffectorCompute = new EffectorCompute();
  private particleCompute: ParticleCompute = new ParticleCompute();
  /** Per-clip effector output buffers (keyed by clipId) */
  private effectorOutputBuffers: Map<string, SplatStorageBufferResource> = new Map();
  /** Per-clip particle output buffers (keyed by clipId) */
  private particleOutputBuffers: Map<string, SplatStorageBufferResource> = new Map();
  // Wave 4: GPU sort + cull passes
  private visibilityPass = new SplatVisibilityPass();
  private sortPass = new SplatSortPass();
  /** Last known visible count from async readback (used as draw count estimate) */
  private lastVisibleCount: Map<string, number> = new Map();
  private lastRenderDebug: Map<string, GaussianSplatRenderDebugSnapshot> = new Map();
  private lastRenderTargets: Map<string, { texture: GPUTexture; width: number; height: number }> = new Map();
  /** One-time debug logging per clip for smoke-test diagnosis */
  private renderDebugLoggedClips: Set<string> = new Set();

  get isInitialized(): boolean {
    return this._initialized;
  }

  initialize(device: GPUDevice): void {
    if (this._initialized) {
      // If re-initializing with a different device, dispose old resources
      if (this.device !== device) {
        log.info('Device changed, re-initializing');
        this.disposeGpuResources();
      } else {
        return;
      }
    }

    this.device = device;

    try {
      this.createPipeline();
      this.createCameraBuffer();
      this.renderTargetPool = new SplatRenderTargetPool(device);
      // Wave 4: Initialize sort + cull passes
      this.visibilityPass.initialize(device);
      // Sort pass is initialized lazily per-scene (needs maxSplatCount)

      this.effectorCompute.initialize(device);
      // Wave 5: Initialize particle compute subsystem
      this.particleCompute.initialize(device);
      this._initialized = true;
      log.info('GaussianSplatGpuRenderer initialized (with sort+cull)');
    } catch (err) {
      log.error('Failed to initialize GaussianSplatGpuRenderer', err);
      this.device = null;
      this._initialized = false;
    }
  }

  /** Upload splat data for a clip. Called once per clip (or on temporal frame change). */
  uploadScene(clipId: string, data: UploadableSplatData): boolean {
    if (!this._initialized || !this.device) {
      log.warn('Cannot upload scene: renderer not initialized');
      return false;
    }

    if (!isUploadableSplatDataValid(data)) {
      log.warn('Invalid splat data', {
        clipId,
        splatCount: data.splatCount,
        dataLength: data.data.length,
        expected: getExpectedSplatFloatCount(data.splatCount),
      });
      return false;
    }

    try {
      // Release existing scene for this clip
      this.releaseScene(clipId);

      const bufferSize = getSplatBufferByteSize(data.splatCount);
      const splatDataLayout = this.pipelines!.splatDataBindGroupLayout;
      const splatBuffer = createSplatDataBuffer(this.device, clipId, data);
      const identityIndexBuffer = createIdentityIndexBuffer(this.device, data.splatCount, clipId);
      const bindGroup = createSplatDataBindGroup(
        this.device,
        splatDataLayout,
        splatBuffer,
        identityIndexBuffer,
        `splat-bind-group-${clipId}`,
      );

      let workerSorter: SplatOrderSorter | null = null;
      let workerSortedBindGroup: GPUBindGroup | null = null;
      try {
        workerSorter = new SplatOrderSorter(this.device, clipId, data.data, data.splatCount);
        workerSortedBindGroup = createSplatDataBindGroup(
          this.device,
          splatDataLayout,
          splatBuffer,
          workerSorter.orderBuffer,
          `splat-worker-sorted-bind-group-${clipId}`,
        );
      } catch (sorterError) {
        log.warn('Worker sorter unavailable; realtime splats will use GPU/identity ordering', {
          clipId,
          error: sorterError instanceof Error ? sorterError.message : String(sorterError),
        });
      }

      this.sceneCache.set(clipId, {
        splatBuffer,
        splatCount: data.splatCount,
        identityIndexBuffer,
        bindGroup,
        framesSinceSort: 0,
        sortedBindGroup: null,
        workerSorter,
        workerSortedBindGroup,
        activeWorkerSortedBindGroup: null,
      });

      // Initialize sort pass for this scene's capacity (lazy init)
      if (data.splatCount > SORT_THRESHOLD) {
        this.sortPass.initialize(this.device, data.splatCount);
      }

      log.debug('Uploaded scene', { clipId, splatCount: data.splatCount, bufferSize });
      return true;
    } catch (err) {
      log.error('Failed to upload scene', { clipId, error: err });
      return false;
    }
  }

  /** Release GPU resources for a clip */
  releaseScene(clipId: string): void {
    const scene = this.sceneCache.get(clipId);
    if (scene) {
      scene.splatBuffer.destroy();
      scene.identityIndexBuffer.destroy();
      scene.workerSorter?.destroy();
      this.sceneCache.delete(clipId);
      this.lastVisibleCount.delete(clipId);
      releaseEffectorStorageBuffer(this.effectorOutputBuffers, clipId);
      // Also clean up particle buffers for this clip
      releaseParticleStorageBuffer(this.particleOutputBuffers, clipId);
      log.debug('Released scene', { clipId });
    }
  }

  /**
   * Render one splat layer into a GPU texture. Returns textureView or null.
   *
   * Pipeline order:
   *   1. Temporal sampling — frame switching handled externally via uploadScene()
   *   2. Particle offsets (compute pass, if enabled) [Wave 5]
   *   3. Frustum culling (compute, if splatCount > CULL_THRESHOLD) [Wave 4]
   *   4. Depth sort (compute, if splatCount > SORT_THRESHOLD) [Wave 4]
   *   5. Rasterize (instanced quad rendering with sorted index indirection)
   *
   * @param options - Optional render/temporal/particle settings from layer source
   */
  renderToTexture(
    clipId: string,
    camera: SplatCameraParams,
    viewport: { width: number; height: number },
    commandEncoder: GPUCommandEncoder,
    options?: SplatRenderOptions,
  ): GPUTextureView | null {
    if (!this._initialized || !this.device || !this.pipelines) {
      return null;
    }

    const scene = this.sceneCache.get(clipId);
    if (!scene) {
      log.debug('No scene uploaded for clip', { clipId });
      return null;
    }

    if (viewport.width <= 0 || viewport.height <= 0) {
      return null;
    }

    try {
      const {
        worldMatrix,
        layerOpacity,
        depthAlphaCutoff,
        maxSplats,
        sortFrequency,
        clearColor,
        precise,
      } = prepareSplatRenderParams(options);
      const cameraBindGroup = this.writeCameraUniforms(camera, worldMatrix, layerOpacity, depthAlphaCutoff);
      if (!cameraBindGroup) {
        return null;
      }

      // Determine which splat data buffer to use (may be overridden by particle pass)
      let activeSplatBuffer = scene.splatBuffer;
      let activeSplatCount = scene.splatCount;
      const effectors = options?.effectors ?? [];

      if (effectors.length > 0 && this.effectorCompute.isInitialized) {
        const localEffectors = this.effectorCompute.prepareLocalSplatEffectors(worldMatrix, effectors);
        if (localEffectors.length > 0) {
          const effectorOutput = getOrCreateEffectorStorageBuffer(
            this.device,
            this.effectorOutputBuffers,
            clipId,
            scene.splatCount,
          );
          this.effectorCompute.execute(
            this.device,
            commandEncoder,
            activeSplatBuffer,
            effectorOutput.buffer,
            scene.splatCount,
            localEffectors,
          );
          activeSplatBuffer = effectorOutput.buffer;
          activeSplatCount = scene.splatCount;
        }
      }

      // ── Step 2: Particle offsets (compute pass) [Wave 5] ──
      const particleSettings = options?.particleSettings;
      const clipLocalTime = options?.clipLocalTime ?? 0;

      if (
        particleSettings?.enabled &&
        particleSettings.effectType !== 'none' &&
        this.particleCompute.isInitialized
      ) {
        const particleOutput = getOrCreateParticleStorageBuffer(
          this.device,
          this.particleOutputBuffers,
          clipId,
          scene.splatCount,
        );
        this.particleCompute.execute(
          this.device,
          commandEncoder,
          activeSplatBuffer,
          particleOutput.buffer,
          scene.splatCount,
          clipLocalTime,
          particleSettings,
        );
        activeSplatBuffer = particleOutput.buffer;
        activeSplatCount = scene.splatCount;
      }

      // Determine effective splat count (respect maxSplats budget)
      const effectiveSplatCount = maxSplats > 0
        ? Math.min(activeSplatCount, maxSplats)
        : activeSplatCount;

      // ── Step 3: Frustum Culling [Wave 4] ──────────────────────────────────
      let cullIndexBuffer: GPUBuffer | null = null;
      let hasValidatedCullResult = false;
      const workerSortFrame = updateWorkerSortFrame(
        scene,
        this.device.queue,
        camera.viewMatrix,
        worldMatrix,
        effectiveSplatCount,
        sortFrequency,
        precise,
      );
      const { canUseWorkerSort, usedWorkerSort } = workerSortFrame;
      let drawCount = workerSortFrame.drawCount;

      if (
        !canUseWorkerSort &&
        !precise &&
        this.visibilityPass.isInitialized &&
        effectiveSplatCount > CULL_THRESHOLD
      ) {
        const cullResult = this.visibilityPass.execute(
          this.device, commandEncoder,
          activeSplatBuffer, effectiveSplatCount,
          camera.viewMatrix, camera.projectionMatrix, worldMatrix,
        );

        if (cullResult) {
          const validatedVisibleCount = this.lastVisibleCount.get(clipId);
          if (validatedVisibleCount !== undefined && validatedVisibleCount > 0) {
            cullIndexBuffer = cullResult.visibleIndexBuffer;
            drawCount = Math.min(validatedVisibleCount, effectiveSplatCount);
            hasValidatedCullResult = true;
          }

          // Kick off async readback for next frame's draw count using a dedicated
          // staging buffer so multiple active clips do not race on shared readback state.
          const readbackBuffer = this.device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            label: `splat-visible-count-readback-${clipId}`,
          });
          commandEncoder.copyBufferToBuffer(
            cullResult.counterBuffer, 0,
            readbackBuffer, 0,
            4,
          );
          this.readbackVisibleCount(clipId, readbackBuffer);
        }
      }

      // ── Step 4: Depth Sort (back-to-front) [Wave 4] ──────────────────────
      const {
        sortedIndexBuffer,
        shouldSort,
        sortThisFrame,
      } = updateGpuSortFrame({
        scene,
        sortPass: this.sortPass,
        device: this.device,
        commandEncoder,
        activeSplatBuffer,
        cullIndexBuffer,
        effectiveSplatCount,
        drawCount,
        canUseWorkerSort,
        precise,
        hasValidatedCullResult,
        sortFrequency,
        viewMatrix: camera.viewMatrix,
        worldMatrix,
      });

      // ── Step 5: Rasterize ────────────────────────────────────────────────
      const targetView = resolveSplatRenderTarget(
        this.renderTargetPool,
        this.lastRenderTargets,
        clipId,
        viewport,
        options?.outputView,
      );

      // Determine which bind group to use
      let renderBindGroup = scene.bindGroup; // default: identity indices + original data

      // Build the appropriate bind group based on which passes ran
      if (canUseWorkerSort && scene.workerSorter && scene.workerSortedBindGroup) {
        renderBindGroup = activeSplatBuffer === scene.splatBuffer
          ? scene.workerSortedBindGroup
          : this.getActiveWorkerSortedBindGroup(scene, clipId, activeSplatBuffer, scene.workerSorter.orderBuffer);
      } else if (sortedIndexBuffer || cullIndexBuffer || activeSplatBuffer !== scene.splatBuffer) {
        const indexBuf = sortedIndexBuffer ?? cullIndexBuffer ?? scene.identityIndexBuffer;
        renderBindGroup = createSplatDataBindGroup(
          this.device,
          this.pipelines!.splatDataBindGroupLayout,
          activeSplatBuffer,
          indexBuf,
          `splat-active-bind-group-${clipId}`,
        );
        if (sortedIndexBuffer) {
          scene.sortedBindGroup = renderBindGroup;
        }
      } else if (scene.sortedBindGroup && shouldSort && !sortThisFrame) {
        // Reuse last sorted bind group on skip frames
        renderBindGroup = scene.sortedBindGroup;
      }

      const passEncoder = commandEncoder.beginRenderPass(
        buildSplatRenderPassDescriptor(clipId, targetView, clearColor, options),
      );

      passEncoder.setPipeline(this.getRenderPipeline(
        !!options?.depthView,
        options?.depthWrite === true,
        options?.colorWrite !== false,
      ));
      passEncoder.setBindGroup(0, renderBindGroup);
      passEncoder.setBindGroup(1, cameraBindGroup);

      recordSplatRenderDebug(log, this.renderDebugLoggedClips, this.lastRenderDebug, {
        clipId,
        sceneSplatCount: scene.splatCount,
        activeSplatCount,
        effectiveSplatCount,
        drawCount,
        viewport,
        backgroundColor: options?.backgroundColor,
        hasParticleOverride: activeSplatBuffer !== scene.splatBuffer,
        usedCull: !!cullIndexBuffer,
        usedSort: usedWorkerSort || !!sortedIndexBuffer,
      });
      // Instanced draw: 4 vertices per quad, one instance per splat
      passEncoder.draw(4, drawCount, 0, 0);
      passEncoder.end();

      return targetView;
    } catch (err) {
      log.error('renderToTexture failed', { clipId, error: err });
      return null;
    }
  }

  /** Called at start of each frame to reset per-frame state */
  beginFrame(): void {
    if (this.renderTargetPool) {
      this.renderTargetPool.resetFrame();
    }
    this.cameraUniformCursor = 0;
  }

  hasScene(clipId: string): boolean {
    return this.sceneCache.has(clipId);
  }

  getLastRenderDebug(clipId: string): GaussianSplatRenderDebugSnapshot | null {
    return this.lastRenderDebug.get(clipId) ?? null;
  }

  async readLastRenderTargetSummary(clipId: string): Promise<GaussianSplatRenderTargetSummary | null> {
    if (!this.device) return null;

    const target = this.lastRenderTargets.get(clipId);
    if (!target) return null;

    const { texture, width, height } = target;
    const readbackLayout = buildRenderTargetReadbackLayout(width, height);

    const readbackBuffer = this.device.createBuffer({
      size: readbackLayout.bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: `splat-render-target-readback-${clipId}`,
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture },
      { buffer: readbackBuffer, bytesPerRow: readbackLayout.bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readbackBuffer.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(readbackBuffer.getMappedRange());
    const summary = summarizeRenderTargetPixels(src, width, height, readbackLayout);

    readbackBuffer.unmap();
    readbackBuffer.destroy();

    return {
      width,
      height,
      ...summary,
    };
  }

  dispose(): void {
    this.disposeGpuResources();
    this.device = null;
    this._initialized = false;
    log.info('GaussianSplatGpuRenderer disposed');
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private getActiveWorkerSortedBindGroup(
    scene: SplatSceneGpuResources,
    clipId: string,
    dataBuffer: GPUBuffer,
    orderBuffer: GPUBuffer,
  ): GPUBindGroup {
    const cached = scene.activeWorkerSortedBindGroup;
    if (cached && cached.dataBuffer === dataBuffer && cached.orderBuffer === orderBuffer) {
      return cached.bindGroup;
    }

    const bindGroup = createSplatDataBindGroup(
      this.device!,
      this.pipelines!.splatDataBindGroupLayout,
      dataBuffer,
      orderBuffer,
      `splat-worker-sorted-active-bind-group-${clipId}`,
    );
    scene.activeWorkerSortedBindGroup = { dataBuffer, orderBuffer, bindGroup };
    return bindGroup;
  }

  private disposeGpuResources(): void {
    // Release all scenes
    for (const [clipId, scene] of this.sceneCache) {
      scene.splatBuffer.destroy();
      scene.identityIndexBuffer.destroy();
      scene.workerSorter?.destroy();
      log.debug('Disposed scene buffer', { clipId });
    }
    this.sceneCache.clear();
    this.lastVisibleCount.clear();
    this.lastRenderDebug.clear();
    this.lastRenderTargets.clear();
    this.renderDebugLoggedClips.clear();

    for (const [, entry] of this.effectorOutputBuffers) {
      entry.buffer.destroy();
    }
    this.effectorOutputBuffers.clear();

    // Wave 5: Dispose particle output buffers
    for (const [, entry] of this.particleOutputBuffers) {
      entry.buffer.destroy();
    }
    this.particleOutputBuffers.clear();

    this.effectorCompute.dispose();

    // Wave 5: Dispose particle compute subsystem
    this.particleCompute.dispose();

    // Dispose camera uniform pool
    for (const resource of this.cameraUniformPool) {
      resource.buffer.destroy();
    }
    this.cameraUniformPool = [];
    this.cameraUniformCursor = 0;

    // Dispose render target pool
    if (this.renderTargetPool) {
      this.renderTargetPool.dispose();
    }

    // Wave 4: Dispose sort + cull passes
    this.visibilityPass.dispose();
    this.sortPass.dispose();

    // Nullify pipelines and layouts (they don't need explicit destruction)
    this.pipelines = null;
  }

  private createPipeline(): void {
    if (!this.device) return;

    this.pipelines = createSplatRenderPipelines(this.device);
    log.debug('Render pipeline created');
  }

  private createCameraBuffer(): void {
    this.cameraUniformPool = [];
    this.cameraUniformCursor = 0;
  }

  private getCameraUniformResource(): SplatCameraUniformResource | null {
    if (!this.device || !this.pipelines) return null;

    const index = this.cameraUniformCursor++;
    const existing = this.cameraUniformPool[index];
    if (existing) {
      return existing;
    }

    const resource = createSplatCameraUniformResource(
      this.device,
      this.pipelines.cameraBindGroupLayout,
      index,
    );
    this.cameraUniformPool[index] = resource;
    return resource;
  }

  private getRenderPipeline(hasDepth: boolean, depthWrite: boolean, colorWrite: boolean): GPURenderPipeline {
    return selectSplatRenderPipeline(this.pipelines!, hasDepth, depthWrite, colorWrite);
  }

  private writeCameraUniforms(
    camera: SplatCameraParams,
    worldMatrix: Float32Array,
    layerOpacity: number,
    depthAlphaCutoff: number,
  ): GPUBindGroup | null {
    if (!this.device) return null;
    const resource = this.getCameraUniformResource();
    if (!resource) return null;

    return writeSplatCameraUniforms(this.device, resource, camera, worldMatrix, layerOpacity, depthAlphaCutoff);

  }

  /**
   * Asynchronously read back the visible splat count from the cull pass.
   * Updates lastVisibleCount for the next frame's draw call.
   */
  private readbackVisibleCount(clipId: string, readbackBuffer: GPUBuffer): void {
    if (!this.device) {
      readbackBuffer.destroy();
      return;
    }

    this.device.queue.onSubmittedWorkDone()
      .then(() => readbackBuffer.mapAsync(GPUMapMode.READ))
      .then(() => {
        const data = new Uint32Array(readbackBuffer.getMappedRange());
        const count = data[0] ?? 0;
        this.lastVisibleCount.set(clipId, count);
        readbackBuffer.unmap();
        readbackBuffer.destroy();
      })
      .catch((err) => {
        readbackBuffer.destroy();
        log.debug('Visible count readback failed (expected during rapid frame changes)', { clipId, error: err });
      });
  }
}

// ── HMR Singleton ─────────────────────────────────────────────────────────────

let instance: GaussianSplatGpuRenderer | null = null;

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose((data) => {
    instance?.dispose();
    data.gaussianSplatGpuRenderer = null;
    instance = null;
  });
}

export function getGaussianSplatGpuRenderer(): GaussianSplatGpuRenderer {
  if (!instance) instance = new GaussianSplatGpuRenderer();
  return instance;
}

export function resetGaussianSplatGpuRenderer(): void {
  instance?.dispose();
  instance = null;
}
