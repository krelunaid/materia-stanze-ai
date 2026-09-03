import { beforeEach, describe, expect, it, vi } from 'vitest';

const takePhoto = vi.fn();
const chooseFromGallery = vi.fn();
const isNativePlatform = vi.fn(() => false);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform() },
}));

vi.mock('@capacitor/camera', () => ({
  Camera: {
    takePhoto: (...args: unknown[]) => takePhoto(...args),
    chooseFromGallery: (...args: unknown[]) => chooseFromGallery(...args),
  },
  MediaTypeSelection: { Photo: 'PHOTO', Video: 'VIDEO', All: 'ALL' },
}));

import {
  fileFromNativePhoto,
  isPhotoPickerCancel,
  pickPhotoOrFallbackToInput,
} from './native-photo-picker';

describe('native photo picker', () => {
  beforeEach(() => {
    takePhoto.mockReset();
    chooseFromGallery.mockReset();
    isNativePlatform.mockReturnValue(false);
  });

  it('builds a File from a Capacitor photo URI, including HEIC', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'image/heic' },
    })));
    const file = await fileFromNativePhoto({
      webPath: 'capacitor://localhost/_capacitor_file_/photo.heic',
      format: 'heic',
    });
    expect(file.name).toBe('photo.heic');
    expect(file.type).toBe('image/heic');
    expect(file.size).toBeGreaterThan(0);
  });

  it('treats user dismissal as a cancel, not a failure', () => {
    expect(isPhotoPickerCancel({ code: 'OS-PLUG-CAMR-0003', message: 'User cancelled photos app' })).toBe(true);
    expect(isPhotoPickerCancel(new Error('User cancelled photos app.'))).toBe(true);
    expect(isPhotoPickerCancel(new Error('plugin is not implemented'))).toBe(false);
  });

  it('uses the HTML file input on web', async () => {
    const input = { click: vi.fn() } as unknown as HTMLInputElement;
    const onFile = vi.fn();
    await expect(pickPhotoOrFallbackToInput({ source: 'photos', input, onFile })).resolves.toBe('fallback');
    expect(chooseFromGallery).not.toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it('delivers a native Photos pick without touching the file input', async () => {
    isNativePlatform.mockReturnValue(true);
    chooseFromGallery.mockResolvedValue({
      results: [{ webPath: 'blob:photo', metadata: { format: 'jpeg' } }],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 8, 7]), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    })));
    const input = { click: vi.fn() } as unknown as HTMLInputElement;
    const onFile = vi.fn();
    await expect(pickPhotoOrFallbackToInput({ source: 'photos', input, onFile })).resolves.toBe('native');
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0]).toMatchObject({ name: 'photo.jpg', type: 'image/jpeg' });
    expect(input.click).not.toHaveBeenCalled();
  });

  it('falls back to the file input when the native picker throws', async () => {
    isNativePlatform.mockReturnValue(true);
    takePhoto.mockRejectedValue(new Error('plugin is not implemented on ios'));
    const input = { click: vi.fn() } as unknown as HTMLInputElement;
    const onFile = vi.fn();
    await expect(pickPhotoOrFallbackToInput({ source: 'camera', input, onFile })).resolves.toBe('fallback');
    expect(onFile).not.toHaveBeenCalled();
    expect(input.click).toHaveBeenCalledTimes(1);
  });

  it('does not open the file input after the user cancels the native picker', async () => {
    isNativePlatform.mockReturnValue(true);
    chooseFromGallery.mockRejectedValue(new Error('User cancelled photos app'));
    const input = { click: vi.fn() } as unknown as HTMLInputElement;
    const onFile = vi.fn();
    await expect(pickPhotoOrFallbackToInput({ source: 'photos', input, onFile })).resolves.toBe('cancelled');
    expect(onFile).not.toHaveBeenCalled();
    expect(input.click).not.toHaveBeenCalled();
  });
});
