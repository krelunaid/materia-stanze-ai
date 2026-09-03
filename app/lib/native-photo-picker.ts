import { Camera, MediaTypeSelection } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

export type NativePhotoSource = 'photos' | 'camera';

export function isNativePlatform() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isPhotoPickerCancel(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /cancel/i.test(code) || /cancel/i.test(message);
}

function mimeForPhoto(format?: string, fallback?: string) {
  const value = `${format ?? ''} ${fallback ?? ''}`.toLowerCase();
  if (value.includes('heic')) return 'image/heic';
  if (value.includes('heif')) return 'image/heif';
  if (value.includes('png')) return 'image/png';
  if (value.includes('webp')) return 'image/webp';
  if (value.includes('jpeg') || value.includes('jpg')) return 'image/jpeg';
  return fallback && fallback.startsWith('image/') ? fallback : 'image/jpeg';
}

function extensionForMime(mime: string, format?: string) {
  if (mime === 'image/heic' || format === 'heic') return 'heic';
  if (mime === 'image/heif' || format === 'heif') return 'heif';
  if (mime === 'image/png' || format === 'png') return 'png';
  if (mime === 'image/webp' || format === 'webp') return 'webp';
  return 'jpg';
}

export async function fileFromNativePhoto(photo: {
  webPath?: string;
  dataUrl?: string;
  format?: string;
}): Promise<File> {
  const source = photo.dataUrl || photo.webPath;
  if (!source) throw new Error('Nessuna foto disponibile.');
  const response = await fetch(source);
  if (!response.ok) throw new Error('Non riesco a leggere la foto scelta.');
  const blob = await response.blob();
  const mime = mimeForPhoto(photo.format, blob.type);
  return new File([blob], `photo.${extensionForMime(mime, photo.format)}`, {
    type: mime,
    lastModified: Date.now(),
  });
}

export async function pickNativePhoto(source: NativePhotoSource): Promise<File> {
  if (source === 'camera') {
    const photo = await Camera.takePhoto({
      quality: 90,
      correctOrientation: true,
      includeMetadata: true,
    });
    return fileFromNativePhoto({ webPath: photo.webPath, format: photo.metadata?.format });
  }

  const { results } = await Camera.chooseFromGallery({
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: false,
    quality: 90,
    correctOrientation: true,
    includeMetadata: true,
  });
  const photo = results[0];
  if (!photo?.webPath) throw new Error('Nessuna foto disponibile.');
  return fileFromNativePhoto({ webPath: photo.webPath, format: photo.metadata?.format });
}

export async function pickPhotoOrFallbackToInput(options: {
  source: NativePhotoSource;
  input: HTMLInputElement | null;
  onFile: (file: File) => void;
}): Promise<'native' | 'fallback' | 'cancelled'> {
  if (isNativePlatform()) {
    try {
      options.onFile(await pickNativePhoto(options.source));
      return 'native';
    } catch (error) {
      if (isPhotoPickerCancel(error)) return 'cancelled';
    }
  }
  options.input?.click();
  return 'fallback';
}
