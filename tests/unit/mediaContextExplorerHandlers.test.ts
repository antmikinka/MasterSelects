import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadMediaFileInBrowser,
} from '../../src/components/panels/media/context/useMediaContextExplorerHandlers';

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

function restoreUrlApis(): void {
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectUrl,
    });
  } else {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  }

  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  } else {
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  }
}

function installUrlSpies(objectUrl = 'blob:media-download') {
  const createObjectUrl = vi.fn(() => objectUrl);
  const revokeObjectUrl = vi.fn();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  });

  return {
    createObjectUrl,
    revokeObjectUrl,
  };
}

describe('downloadMediaFileInBrowser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreUrlApis();
    document.body.innerHTML = '';
  });

  it('downloads an in-memory file through an object URL and revokes it', () => {
    const urls = installUrlSpies();
    const file = new File(['video'], 'Clip.mp4', { type: 'video/mp4' });
    let clickedHref = '';
    let clickedDownload = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });

    expect(downloadMediaFileInBrowser({ file, name: 'Clip.mp4', url: '' })).toBe(true);

    expect(urls.createObjectUrl).toHaveBeenCalledWith(file);
    expect(clickedHref).toBe('blob:media-download');
    expect(clickedDownload).toBe('Clip.mp4');
    expect(urls.revokeObjectUrl).toHaveBeenCalledWith('blob:media-download');
  });

  it('falls back to the stored media URL when the File is not hydrated', () => {
    const urls = installUrlSpies();
    let clickedHref = '';
    let clickedDownload = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });

    expect(downloadMediaFileInBrowser({
      file: undefined,
      name: 'Proxy.wav',
      url: 'blob:stored-media',
    })).toBe(true);

    expect(urls.createObjectUrl).not.toHaveBeenCalled();
    expect(clickedHref).toBe('blob:stored-media');
    expect(clickedDownload).toBe('Proxy.wav');
    expect(urls.revokeObjectUrl).not.toHaveBeenCalled();
  });
});
