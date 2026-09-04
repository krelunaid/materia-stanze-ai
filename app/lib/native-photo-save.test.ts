import { afterEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ isNative: vi.fn(), saveImage: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native.isNative }, registerPlugin: () => ({ saveImage: native.saveImage }) }));
import { saveNativePhoto } from './native-photo-save';
afterEach(() => vi.resetAllMocks());

it('uses the native photo library bridge and waits for confirmed completion', async () => {
  native.isNative.mockReturnValue(true);
  native.saveImage.mockResolvedValue(undefined);
  await expect(saveNativePhoto(new Blob(['image'], { type: 'image/png' }))).resolves.toBe(true);
  expect(native.saveImage).toHaveBeenCalledWith({ base64: btoa('image') });
});
it('does not report success if permission or native saving fails', async () => {
  native.isNative.mockReturnValue(true);
  native.saveImage.mockRejectedValue(new Error('Accesso negato'));
  await expect(saveNativePhoto(new Blob(['image']))).rejects.toThrow('Accesso negato');
});
it('leaves browser downloads to the web save flow', async () => {
  native.isNative.mockReturnValue(false);
  await expect(saveNativePhoto(new Blob())).resolves.toBe(false);
  expect(native.saveImage).not.toHaveBeenCalled();
});
