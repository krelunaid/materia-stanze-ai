import { describe, expect, it } from 'vitest';
import { deriveProjectName, formatBytes, MAX_FILE_BYTES, validateRoomFile } from './file-validation';

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
