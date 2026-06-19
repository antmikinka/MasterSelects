import faderCapTopdownUrl from './fadercap-topdown.svg';
import centerRecessUrl from './wood-theme/center-recess.webp';
import cornerScrewBrassUrl from './wood-theme/corner-screw-brass.webp';
import darkLeatherUrl from './wood-theme/dark-leather.webp';
import faderCapSteelUrl from './wood-theme/fadercap-steel.webp';
import masterFaderCapBronzeUrl from './wood-theme/master-fadercap-bronze.webp';
import panKnobUrl from './wood-theme/pan-knob.webp';
import plateBronzeUrl from './wood-theme/plate-bronze.webp';
import pocketLeatherUrl from './wood-theme/pocket-leather.webp';
import railScrewPhillipsBrassUrl from './wood-theme/rail-screw-phillips-brass.webp';
import woodBodyUrl from './wood-theme/wood-body.webp';
import woodPanelDarkUrl from './wood-theme/wood-panel-dark.webp';
import { importAudioMixerPanel } from './audioMixerPanelLoader';

interface AudioMixerWarmupOptions {
  includeWoodThemeImages?: boolean;
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
};

type FetchPriorityImage = HTMLImageElement & {
  fetchPriority?: 'high' | 'low' | 'auto';
};

const BASE_IMAGE_URLS = [
  faderCapTopdownUrl,
] as const;

const WOOD_THEME_IMAGE_URLS = [
  woodPanelDarkUrl,
  darkLeatherUrl,
  centerRecessUrl,
  masterFaderCapBronzeUrl,
  faderCapSteelUrl,
  plateBronzeUrl,
  cornerScrewBrassUrl,
  panKnobUrl,
  railScrewPhillipsBrassUrl,
  woodBodyUrl,
  pocketLeatherUrl,
] as const;

let moduleWarmupStarted = false;
let baseImageWarmupStarted = false;
let woodImageWarmupStarted = false;
const imagePreloadUrls = new Set<string>();
const imageWarmupPromises = new Map<string, Promise<void>>();
const retainedWarmupImages = new Map<string, HTMLImageElement>();
let woodBackgroundWarmupRoot: HTMLDivElement | null = null;

function isDockLayoutAvailable(): boolean {
  return typeof window !== 'undefined'
    && (
      typeof window.matchMedia !== 'function'
      || !window.matchMedia('(max-width: 768px)').matches
    );
}

function scheduleIdle(callback: () => void): void {
  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(callback, { timeout: 1800 });
    return;
  }

  window.setTimeout(callback, 350);
}

function waitForNextTurn(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function preloadImage(url: string, fetchPriority: FetchPriorityImage['fetchPriority'] = 'auto'): void {
  if (typeof document === 'undefined' || imagePreloadUrls.has(url)) {
    return;
  }

  imagePreloadUrls.add(url);
  const link = document.createElement('link') as HTMLLinkElement & {
    fetchPriority?: FetchPriorityImage['fetchPriority'];
  };
  link.rel = 'preload';
  link.as = 'image';
  link.href = url;
  link.fetchPriority = fetchPriority;
  document.head.appendChild(link);
}

function mountWoodBackgroundWarmup(urls: readonly string[]): void {
  if (typeof document === 'undefined' || urls.length === 0) {
    return;
  }

  const host = document.body ?? document.documentElement;
  if (!host) {
    return;
  }

  if (!woodBackgroundWarmupRoot) {
    woodBackgroundWarmupRoot = document.createElement('div');
    woodBackgroundWarmupRoot.setAttribute('aria-hidden', 'true');
    woodBackgroundWarmupRoot.style.cssText = [
      'position:fixed',
      'left:-10000px',
      'top:-10000px',
      'width:1px',
      'height:1px',
      'overflow:hidden',
      'opacity:0',
      'pointer-events:none',
      'contain:layout paint style',
      'z-index:-1',
    ].join(';');
    host.appendChild(woodBackgroundWarmupRoot);
  }

  const existingUrls = new Set(
    Array.from(woodBackgroundWarmupRoot.children)
      .map((child) => (child as HTMLElement).dataset.audioMixerWarmupUrl)
      .filter((url): url is string => typeof url === 'string'),
  );

  urls.forEach((url) => {
    if (existingUrls.has(url)) {
      return;
    }

    const element = document.createElement('div');
    element.dataset.audioMixerWarmupUrl = url;
    element.style.cssText = [
      'width:128px',
      'height:128px',
      `background-image:url("${url}")`,
      'background-size:cover',
      'background-repeat:repeat',
      'background-position:center',
    ].join(';');
    woodBackgroundWarmupRoot?.appendChild(element);
  });

  // Force style resolution so the CSS-background path starts before the first
  // visible Audio Mixer mount. The node is intentionally retained.
  void woodBackgroundWarmupRoot.offsetHeight;
}

async function decodeImage(
  url: string,
  fetchPriority: FetchPriorityImage['fetchPriority'] = 'auto',
): Promise<void> {
  const image = new Image() as FetchPriorityImage;
  image.decoding = 'async';
  image.fetchPriority = fetchPriority;
  image.src = url;
  retainedWarmupImages.set(url, image);

  if (typeof image.decode === 'function') {
    await image.decode();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Failed to preload ${url}`));
  });
}

function warmImage(url: string, fetchPriority: FetchPriorityImage['fetchPriority'] = 'auto'): Promise<void> {
  const existing = imageWarmupPromises.get(url);
  if (existing) {
    return existing;
  }

  preloadImage(url, fetchPriority);
  const promise = decodeImage(url, fetchPriority).catch(() => {
    // Warmup is opportunistic; the visible CSS path can still load the asset.
  });
  imageWarmupPromises.set(url, promise);
  return promise;
}

async function warmImages(
  urls: readonly string[],
  fetchPriority: FetchPriorityImage['fetchPriority'] = 'auto',
): Promise<void> {
  await Promise.all(urls.map((url) => warmImage(url, fetchPriority)));
  await waitForNextTurn();
}

export function scheduleAudioMixerWarmup(options: AudioMixerWarmupOptions = {}): void {
  if (!isDockLayoutAvailable()) {
    return;
  }

  if (!moduleWarmupStarted) {
    moduleWarmupStarted = true;
    window.setTimeout(() => {
      void importAudioMixerPanel().catch(() => undefined);
    }, 0);
  }

  const shouldWarmBaseImages = !baseImageWarmupStarted;
  const shouldWarmWoodImages = options.includeWoodThemeImages === true && !woodImageWarmupStarted;
  if (!shouldWarmBaseImages && !shouldWarmWoodImages) {
    return;
  }
  baseImageWarmupStarted = true;
  woodImageWarmupStarted = woodImageWarmupStarted || shouldWarmWoodImages;

  if (shouldWarmBaseImages) {
    BASE_IMAGE_URLS.forEach((url) => preloadImage(url, 'auto'));
  }
  if (shouldWarmWoodImages) {
    WOOD_THEME_IMAGE_URLS.forEach((url) => preloadImage(url, 'high'));
    mountWoodBackgroundWarmup(WOOD_THEME_IMAGE_URLS);
    void warmImages(WOOD_THEME_IMAGE_URLS, 'high');
  }

  scheduleIdle(() => {
    if (shouldWarmBaseImages) {
      void warmImages(BASE_IMAGE_URLS, 'auto');
    }
  });
}
