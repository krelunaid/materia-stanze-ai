import { Capacitor, registerPlugin } from '@capacitor/core';

const Photos = registerPlugin<{ saveImage(options: { base64: string }): Promise<void> }>('MateriaPhotos');

export async function saveNativePhoto(blob: Blob): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Non riesco a leggere il render.'));
    reader.readAsDataURL(blob);
  });
  await Photos.saveImage({ base64 });
  return true;
}
