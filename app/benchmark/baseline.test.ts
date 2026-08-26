import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestJson from '../../benchmark/dataset-v1/manifest.json';
import annotationJson from '../../benchmark/dataset-v1/annotations/empty-room.geometry.json';
import predictionJson from '../../benchmark/baselines/34ee185/empty-room.prediction.json';
import baselineJson from '../../benchmark/baselines/34ee185/results.json';
import configJson from '../../benchmark/config/geometry-config-v1.json';
import { type BaselineRecord, type DatasetManifest, type GeometryRecord, resolveAnnotations, validateDatasetManifest } from './dataset';
import { evaluateGeometry } from './geometry-metrics';

const manifest = manifestJson as DatasetManifest;
const annotation = annotationJson as GeometryRecord;
const prediction = predictionJson as GeometryRecord;
const baseline = baselineJson as BaselineRecord;

describe('versioned geometry baseline', () => {
  it('contains every mandatory scenario and every mandatory annotation field', () => {
    expect(validateDatasetManifest(manifest)).toEqual([]);
    expect(manifest.cases).toHaveLength(43);
    manifest.cases.forEach((testCase) => expect(resolveAnnotations(manifest, testCase)).toBeTypeOf('object'));
  });

  it('serializes and deserializes without data loss', () => {
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
    expect(JSON.parse(JSON.stringify(annotation))).toEqual(annotation);
    expect(JSON.parse(JSON.stringify(baseline))).toEqual(baseline);
  });

  it('reproduces the archived geometry metrics exactly', () => {
    expect(annotation.datasetId).toBe(manifest.datasetId);
    expect(prediction.datasetId).toBe(manifest.datasetId);
    const metrics = evaluateGeometry(annotation.surfaces, prediction.surfaces, annotation.resolution.width, annotation.resolution.height);
    expect(metrics).toEqual({
      segmentationIoU: baseline.metrics.segmentationIoU,
      edgeErrorPx: baseline.metrics.edgeErrorPx,
      doorWidthDeltaPx: baseline.metrics.doorWidthDeltaPx,
      doorHeightDeltaPx: baseline.metrics.doorHeightDeltaPx,
      windowWidthDeltaPx: baseline.metrics.windowWidthDeltaPx,
      windowHeightDeltaPx: baseline.metrics.windowHeightDeltaPx,
    });
  });

  it('binds the measured fixture to an immutable checksum', async () => {
    const crypto = await import('node:crypto');
    const bytes = readFileSync(resolve(process.cwd(), 'public/demo-room.jpg'));
    expect(crypto.createHash('sha256').update(bytes).digest('hex')).toBe(configJson.imageFixtureSha256['public/demo-room.jpg']);
  });

  it('does not present unmeasured scenarios as measured', () => {
    expect(manifest.cases.filter((testCase) => testCase.execution === 'measured')).toHaveLength(baseline.measuredCases);
    expect(manifest.cases).toHaveLength(baseline.registeredCases);
    expect(baseline.limitations).toHaveLength(3);
  });
});
