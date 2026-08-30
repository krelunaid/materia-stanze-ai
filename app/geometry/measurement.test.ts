import { describe, expect, it } from 'vitest';
import { Surface } from '../domain/editor';
import { horizontalSpanAtY, inferRoomMeasurement, measuredFurnitureScale, productWidthMeters } from './measurement';

const surfaces: Surface[] = [
  { id: 'wall', name: 'Muro frontale', kind: 'wall', frozen: false, points: [{ x: .2, y: .12 }, { x: .8, y: .12 }, { x: .8, y: .68 }, { x: .2, y: .68 }] },
  { id: 'floor', name: 'Pavimento', kind: 'floor', frozen: false, points: [{ x: .2, y: .68 }, { x: .8, y: .68 }, { x: 1, y: 1 }, { x: 0, y: 1 }] },
  { id: 'door', parentId: 'wall', name: 'Porta', kind: 'door', frozen: false, points: [{ x: .28, y: .24 }, { x: .42, y: .24 }, { x: .42, y: .68 }, { x: .28, y: .68 }] },
];

describe('automatic room measurement', () => {
  it('uses a detected door as a scale reference', () => {
    const measurement = inferRoomMeasurement(surfaces, 1.6);
    expect(measurement.source).toBe('door');
    expect(measurement.referenceLabel).toContain('2,10 m');
    expect(measurement.widthMeters).toBeGreaterThan(4);
    expect(measurement.heightMeters).toBeGreaterThan(2.5);
    expect(measurement.confidence).toBeGreaterThan(.7);
  });

  it('accepts one confirmed wall width without changing the image geometry', () => {
    const measurement = inferRoomMeasurement(surfaces, 1.6, 5.4);
    expect(measurement.source).toBe('manual');
    expect(measurement.widthMeters).toBe(5.4);
    expect(measurement.confidence).toBe(.98);
  });

  it('reads common furniture dimension formats', () => {
    expect(productWidthMeters('Divano', 'L 240 cm · P 95 cm · H 80 cm')).toBe(2.4);
    expect(productWidthMeters('Tavolo 180 × 90 × 75 cm')).toBe(1.8);
    expect(productWidthMeters('Mobile', 'larghezza 2200 mm')).toBe(2.2);
  });

  it('projects a measured product larger when it moves towards the camera', () => {
    const room = inferRoomMeasurement(surfaces, 1.6, 4.8);
    const farScale = measuredFurnitureScale({ name: 'Divano', description: 'L 240 cm', y: .7, floor: surfaces[1], room, fallback: 30 });
    const nearScale = measuredFurnitureScale({ name: 'Divano', description: 'L 240 cm', y: .95, floor: surfaces[1], room, fallback: 30 });
    expect(horizontalSpanAtY(surfaces[1], .95)).toBeGreaterThan(horizontalSpanAtY(surfaces[1], .7));
    expect(nearScale).toBeGreaterThan(farScale);
  });
});
