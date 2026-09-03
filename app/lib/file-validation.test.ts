import { describe, expect, it } from 'vitest';
import { deriveProjectName, formatBytes, isAcceptedRasterImage, MAX_FILE_BYTES, validateRoomFile } from './file-validation';

describe('validateRoomFile', () => {
  it('accepts a JPEG within the size limit', () => {
    const file = new File(['room'], 'living-room.jpg', { type: 'image/jpeg' });
    const result = validateRoomFile(file);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe('image');
      expect(result.value.canPreview).toBe(true);
      expect(result.value.projectName).toBe('Living room');
    }
  });

  it('accepts HEIC by extension when the browser omits MIME', () => {
    const result = validateRoomFile(new File(['room'], 'camera.heic'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.canPreview).toBe(true);
    expect(isAcceptedRasterImage(new File(['room'], 'prodotto.HEIC'))).toBe(true);
    expect(isAcceptedRasterImage(new File(['room'], 'campione.heif', { type: 'image/heif' }))).toBe(true);
  });

  it('accepts WEBP room photos by MIME type or extension', () => {
    expect(validateRoomFile(new File(['room'], 'pavimento.webp', { type: 'image/webp' })).ok).toBe(true);
    expect(validateRoomFile(new File(['room'], 'pavimento.WEBP')).ok).toBe(true);
  });

  it('accepts very small JPEG and alpha-capable PNG inputs without crashing', () => {
    expect(validateRoomFile(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'tiny.jpg', { type: 'image/jpeg' })).ok).toBe(true);
    expect(validateRoomFile(new File([new Uint8Array([137, 80, 78, 71])], 'alpha.png', { type: 'image/png' })).ok).toBe(true);
  });

  it('accepts an EXIF-oriented JPEG as input while leaving orientation handling to image decoding', () => {
    const exifStub = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 8, 69, 120, 105, 102, 0, 0, 0xff, 0xd9]);
    expect(validateRoomFile(new File([exifStub], 'portrait-exif.jpg', { type: 'image/jpeg' })).ok).toBe(true);
  });

  it('rejects unsupported, empty, oversized and PDF files', () => {
    expect(validateRoomFile(new File(['hello'], 'notes.txt', { type: 'text/plain' })).ok).toBe(false);
    expect(validateRoomFile(new File([], 'empty.png', { type: 'image/png' })).ok).toBe(false);
    expect(validateRoomFile(new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'huge.png', { type: 'image/png' })).ok).toBe(false);
    const pdf = validateRoomFile(new File(['%PDF'], 'planimetria.pdf', { type: 'application/pdf' }));
    expect(pdf.ok).toBe(false);
    if (!pdf.ok) expect(pdf.message).toMatch(/PDF/);
  });
});

describe('file presentation', () => {
  it('formats size and derives a readable project name', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(deriveProjectName('cucina_principale-01.jpg')).toBe('Cucina principale 01');
  });
});
