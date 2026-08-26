import type { BenchmarkSurface, GeometryMetrics } from './geometry-metrics';

export const requiredScenarioIds = [
  'empty-room', 'furnished-room', 'partially-occluded-door', 'two-doors', 'multiple-doors',
  'window', 'multiple-windows', 'corridor', 'irregular-room', 'tilted-photo', 'wide-angle',
  'low-light', 'reflective-floor', 'open-door', 'closed-door', 'clad-walls', 'mirrors',
  'furniture-over-floor', 'furniture-over-jambs', 'furniture-over-windows', 'similar-wall-floor-colors',
  'nearby-openings', 'partially-overlapping-openings', 'noisy-image', 'blurred-image',
  'insufficient-resolution', 'exif-orientation', 'alpha-channel', 'no-lidar', 'no-depth',
  'tracking-loss', 'incomplete-scan', 'interrupted-scan', 'bad-calibration', 'inconsistent-calibration',
  'product-without-dimensions', 'product-incomplete-dimensions', 'slow-network', 'offline-network',
  'api-timeout', 'invalid-api-response', 'resume-after-interruption', 'corrupt-project',
] as const;

export type DatasetManifest = {
  datasetId: string;
  version: string;
  fixtureRoot: string;
  annotationDefaults: Record<string, unknown>;
  cases: Array<{
    id: string;
    scenario: string;
    category: 'photo' | 'device' | 'tracking' | 'calibration' | 'product' | 'network' | 'project';
    fixture: string | null;
    execution: 'measured' | 'registered-unmeasured';
    annotationOverrides: Record<string, unknown>;
  }>;
};

export type GeometryRecord = {
  datasetId: string;
  caseId: string;
  resolution: { width: number; height: number };
  surfaces: BenchmarkSurface[];
};

export type BaselineRecord = {
  baselineId: string;
  datasetId: string;
  codeVersion: string;
  modelVersion: string;
  apiVersion: string;
  configurationId: string;
  timestamp: string;
  measuredCases: number;
  registeredCases: number;
  metrics: GeometryMetrics & Record<string, number | null>;
  limitations: string[];
};

const mandatoryAnnotationFields = [
  'originalImage', 'originalOrientation', 'resolution', 'doors', 'windows', 'walls', 'floor', 'ceiling',
  'corners', 'jambs', 'furniture', 'removableElements', 'structuralElements', 'occludedAreas', 'inferredAreas',
  'realMeasurements', 'producedMasks', 'producedGeometries', 'confidence', 'emptyRoomResult', 'renderResult',
  'processingTimeMs', 'memoryUsageMb', 'errors', 'fallbacks',
];

export function resolveAnnotations(manifest: DatasetManifest, testCase: DatasetManifest['cases'][number]) {
  return { ...manifest.annotationDefaults, ...testCase.annotationOverrides };
}

export function validateDatasetManifest(manifest: DatasetManifest) {
  const errors: string[] = [];
  if (!manifest.datasetId || !manifest.version) errors.push('datasetId e version sono obbligatori');
  const ids = new Set(manifest.cases.map((testCase) => testCase.id));
  requiredScenarioIds.forEach((id) => { if (!ids.has(id)) errors.push(`scenario mancante: ${id}`); });
  if (ids.size !== manifest.cases.length) errors.push('gli identificativi dei casi devono essere univoci');
  manifest.cases.forEach((testCase) => {
    const annotations = resolveAnnotations(manifest, testCase);
    mandatoryAnnotationFields.forEach((field) => {
      if (!(field in annotations)) errors.push(`${testCase.id}: annotazione mancante ${field}`);
    });
    if (testCase.execution === 'measured' && !testCase.fixture) errors.push(`${testCase.id}: fixture mancante`);
  });
  return errors;
}
