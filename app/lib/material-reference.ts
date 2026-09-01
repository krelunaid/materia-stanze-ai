export type MaterialReferenceKind = 'verified-texture' | 'official-product-image' | 'metadata-only' | 'uploaded-sample';

export type SurfaceMaterialReference = {
  category: 'Pavimenti' | 'Rivestimenti' | 'Colori' | 'Arredi';
  sourceUrl?: string;
  referenceKind?: MaterialReferenceKind;
};

/**
 * A product page or an ambient/product photo is not a repeatable surface
 * texture.  Rendering it from metadata alone would force the image model to
 * invent the pattern, so require a flat verified texture or a user sample.
 */
export function requiresVerifiedSurfaceSample(item: SurfaceMaterialReference | null | undefined) {
  return Boolean(item
    && item.sourceUrl
    && item.category !== 'Arredi'
    && item.category !== 'Colori'
    && item.referenceKind !== 'verified-texture'
    && item.referenceKind !== 'uploaded-sample');
}
