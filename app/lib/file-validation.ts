export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const allowedFallbackExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

export type AcceptedRoomFile = {
  file: File;
  kind: 'image' | 'pdf';
  canPreview: boolean;
  displaySize: string;
  projectName: string;
};

export type RoomFileValidation =
  | { ok: true; value: AcceptedRoomFile }
  | { ok: false; message: string };

function extensionOf(name: string) {
  return name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function deriveProjectName(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  const readable = withoutExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!readable) return 'Nuovo progetto';
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function isAcceptedRasterImage(file: File) {
  if (allowedMimeTypes.has(file.type)) return true;
  return file.type === '' && allowedFallbackExtensions.has(extensionOf(file.name));
}

export function validateRoomFile(file: File): RoomFileValidation {
  const extension = extensionOf(file.name);
  const recognizedType = allowedMimeTypes.has(file.type);
  const recognizedFallback = file.type === '' && allowedFallbackExtensions.has(extension);

  const isPdf = file.type === 'application/pdf' || extension === 'pdf';
  if (isPdf) {
    return { ok: false, message: 'Il PDF non è ancora modificabile. Esportalo come JPG o PNG e riprova.' };
  }
  if (!recognizedType && !recognizedFallback) {
    return { ok: false, message: 'Formato non supportato. Usa JPG, PNG, WEBP o HEIC.' };
  }
  if (file.size <= 0) {
    return { ok: false, message: 'Il file è vuoto. Scegli un originale valido.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: 'Il file supera il limite di 20 MB.' };
  }

  return {
    ok: true,
    value: {
      file,
      kind: 'image',
      canPreview: true,
      displaySize: formatBytes(file.size),
      projectName: deriveProjectName(file.name),
    },
  };
}
