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
});
