import { describe, expect, it } from 'vitest';
import { removeConnectedProductBackground } from './product-cutout';

function solidImage(width: number, height: number, color: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set([...color, 255], index * 4);
  return data;
}

describe('removeConnectedProductBackground', () => {
  it('removes a continuous catalog background and keeps the product body', () => {
    const width = 12; const height = 10;
    const data = solidImage(width, height, [245, 245, 242]);
    for (let y = 3; y <= 8; y += 1) for (let x = 3; x <= 8; x += 1) data[(y * width + x) * 4] = 80;
    const result = removeConnectedProductBackground(data, width, height, { left: .15, top: .15, right: .85, bottom: .95 });
    expect(result.data[(1 * width + 1) * 4 + 3]).toBe(0);
    expect(result.data[(5 * width + 5) * 4 + 3]).toBeGreaterThan(0);
    expect(result.crop.left).toBeGreaterThanOrEqual(3);
  });

  it('clears background visible between furniture legs', () => {
    const width = 14; const height = 12;
    const data = solidImage(width, height, [250, 250, 250]);
    for (let x = 3; x <= 10; x += 1) for (let y = 3; y <= 6; y += 1) data[(y * width + x) * 4] = 65;
    for (let y = 6; y <= 10; y += 1) {
      data[(y * width + 3) * 4] = 65;
      data[(y * width + 10) * 4] = 65;
    }
    const result = removeConnectedProductBackground(data, width, height);
    expect(result.data[(8 * width + 6) * 4 + 3]).toBe(0);
    expect(result.data[(8 * width + 3) * 4 + 3]).toBeGreaterThan(0);
  });

  it('keeps the complete largest object and removes detached catalog decoration', () => {
    const width = 18; const height = 14;
    const data = solidImage(width, height, [250, 250, 250]);
    for (let y = 5; y <= 10; y += 1) for (let x = 3; x <= 14; x += 1) data[(y * width + x) * 4] = 70;
    for (let y = 2; y <= 3; y += 1) for (let x = 4; x <= 6; x += 1) data[(y * width + x) * 4] = 40;
    const result = removeConnectedProductBackground(data, width, height);
    expect(result.data[(7 * width + 8) * 4 + 3]).toBeGreaterThan(0);
    expect(result.data[(2 * width + 5) * 4 + 3]).toBe(0);
    expect(result.crop.bottom).toBeGreaterThan(10);
  });

  it('removes connected decor and a long shadow from a low wide cabinet', () => {
    const width = 32; const height = 25;
    const data = solidImage(width, height, [250, 250, 250]);
    // Wide cabinet body.
    for (let y = 9; y <= 15; y += 1) for (let x = 3; x <= 28; x += 1) data[(y * width + x) * 4] = 70;
    // Real legs.
    for (let y = 16; y <= 18; y += 1) {
      for (let x = 5; x <= 7; x += 1) data[(y * width + x) * 4] = 70;
      for (let x = 24; x <= 26; x += 1) data[(y * width + x) * 4] = 70;
    }
    // A book connected to the cabinet top.
    for (let y = 5; y <= 9; y += 1) for (let x = 5; x <= 8; x += 1) data[(y * width + x) * 4] = 70;
    // A connected diagonal cast shadow below the right leg.
    for (let y = 18; y <= 23; y += 1) for (let x = 26 - (y - 18); x <= 29; x += 1) data[(y * width + x) * 4] = 70;

    const result = removeConnectedProductBackground(data, width, height);
    expect(result.data[(12 * width + 16) * 4 + 3]).toBeGreaterThan(0);
    expect(result.data[(18 * width + 6) * 4 + 3]).toBeGreaterThan(0);
    expect(result.data[(6 * width + 6) * 4 + 3]).toBe(0);
    expect(result.data[(23 * width + 26) * 4 + 3]).toBe(0);
  });
});
