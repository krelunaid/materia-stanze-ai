import { describe, expect, it } from 'vitest';
import { requiresVerifiedSurfaceSample } from './material-reference';

describe('requiresVerifiedSurfaceSample', () => {
  it('blocks a wallpaper product page that has no usable texture', () => {
    expect(requiresVerifiedSurfaceSample({
      category: 'Rivestimenti',
      sourceUrl: 'https://example.com/vintage-rose-wallpaper',
      referenceKind: 'metadata-only',
    })).toBe(true);
  });

  it('blocks an ambient product image from being stretched as a texture', () => {
    expect(requiresVerifiedSurfaceSample({
      category: 'Rivestimenti',
      sourceUrl: 'https://example.com/tile',
      referenceKind: 'official-product-image',
    })).toBe(true);
  });

  it('allows verified textures and user samples', () => {
    expect(requiresVerifiedSurfaceSample({
      category: 'Pavimenti',
      sourceUrl: 'https://example.com/floor',
      referenceKind: 'verified-texture',
    })).toBe(false);
    expect(requiresVerifiedSurfaceSample({
      category: 'Rivestimenti',
      referenceKind: 'uploaded-sample',
    })).toBe(false);
  });

  it('does not route furniture or wall colors through the sample gate', () => {
    expect(requiresVerifiedSurfaceSample({
      category: 'Arredi',
      sourceUrl: 'https://example.com/sofa',
      referenceKind: 'official-product-image',
    })).toBe(false);
    expect(requiresVerifiedSurfaceSample({
      category: 'Colori',
      sourceUrl: 'https://example.com/paint',
      referenceKind: 'metadata-only',
    })).toBe(false);
  });
});
