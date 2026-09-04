import {
  detectArchitecturalOpenings,
  detectRoomSurfaces,
  getAiProvider,
  getVisionAuditor,
  mergeArchitecturalOpeningAudit,
  roomShellTopologyStatus,
  verifyEditedRoomShell,
  type DetectedRoomSurface,
} from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';
import { isValidPolygon } from '../../domain/editor';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

function isTransientVisionFailure(caught: unknown) {
  const name = caught instanceof Error ? caught.name.toLowerCase() : '';
  const message = caught instanceof Error ? caught.message.toLowerCase() : String(caught).toLowerCase();
  return name === 'aborterror' || /aborted|timeout|timed out|network connection|fetch failed/.test(message);
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'detect-surfaces');
  if (!access.ok) return access.response;
  const { headers } = access;
  const provider = getAiProvider();
  if (!provider) {
    return json({ code: 'not_configured', message: 'Il riconoscimento automatico richiede Grok attivo sul server.' }, headers, 503);
  }

  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    if (!(image instanceof File) || !['image/jpeg', 'image/png'].includes(image.type)) {
      return json({ message: 'La fotografia deve essere in formato JPG o PNG.' }, headers, 400);
    }
    if (image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, headers, 413);
    const auditor = getVisionAuditor(process.env, provider);
    if (incoming.get('verifyOnly') === 'true') {
      const encoded = String(incoming.get('surfaces') ?? '');
      if (encoded.length > 64000) return json({ message: 'Troppi punti da verificare.' }, headers, 400);
      let candidates: unknown;
      try { candidates = JSON.parse(encoded); } catch { return json({ message: 'Contorni non validi.' }, headers, 400); }
      if (!Array.isArray(candidates) || candidates.length > 30 || !candidates.length || !candidates.every((surface) => (
        surface && ['wall', 'floor', 'ceiling', 'door', 'window'].includes(surface.kind)
        && Array.isArray(surface.points) && surface.points.length >= 3 && surface.points.length <= 128
        && surface.points.every((point: { x?: unknown; y?: unknown }) => point && typeof point.x === 'number' && typeof point.y === 'number'
          && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)
      ))) return json({ message: 'Contorni non validi.' }, headers, 400);
      const edited = candidates as DetectedRoomSurface[];
      if (edited.some((surface) => !isValidPolygon(surface.points))) return json({ accepted: false, reason: 'Un contorno si incrocia o non delimita una superficie valida.' }, headers);
      if (roomShellTopologyStatus(edited) !== 'verified') return json({ accepted: false, reason: 'Muri, pavimento e soffitto non condividono ancora gli stessi angoli.' }, headers);
      return json(await verifyEditedRoomShell(auditor ?? provider, image, edited), headers);
    }
    const detectPrimaryGeometry = async () => {
      try {
        return await detectRoomSurfaces(provider, image, { openingAudit: true, source: 'photo', retainOpeningSeeds: true });
      } catch (caught) {
        if (!isTransientVisionFailure(caught)) throw caught;
        return detectRoomSurfaces(provider, image, { openingAudit: true, source: 'photo', retainOpeningSeeds: true });
      }
    };
    const [primaryResult, auditResult] = await Promise.allSettled([
      detectPrimaryGeometry(),
      auditor ? detectArchitecturalOpenings(auditor, image) : Promise.resolve([]),
    ]);
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
    let auditedOpenings = auditResult.status === 'fulfilled' ? auditResult.value : [];
    let openingAuditAttempts = auditor ? 1 : 0;
    const seedOpenings = primaryResult.value.filter((surface) => surface.kind === 'door' || surface.kind === 'window');
    if (auditor && (seedOpenings.length || auditedOpenings.length === 0)) {
      try {
        openingAuditAttempts += 1;
        const refinementSeeds = [...seedOpenings, ...auditedOpenings].slice(0, 8);
        const refinedOpenings = await detectArchitecturalOpenings(
          auditor,
          image,
          refinementSeeds,
          { recovery: auditedOpenings.length === 0, highEffort: true },
        );
        auditedOpenings = [...auditedOpenings, ...refinedOpenings];
      } catch {
        // The first independent audit still controls whether primary
        // rectangles are trusted. A failed refinement never turns a cabinet
        // or an inner door leaf into protected architecture.
      }
    }
    // When an independent auditor is configured it is authoritative even
    // when it returns no opening: this intentionally drops an unconfirmed
    // cabinet/window rectangle instead of preserving a false positive.
    const surfaces = auditor
      ? mergeArchitecturalOpeningAudit(primaryResult.value, auditedOpenings)
      : primaryResult.value;
    const acceptedOpenings = surfaces.filter((surface) => surface.kind === 'door' || surface.kind === 'window').length;
    const inferredOpeningThresholds = surfaces.filter((surface) => (
      (surface.kind === 'door' || surface.kind === 'window') && surface.thresholdInferred
    )).length;
    const shellGeometryStatus = roomShellTopologyStatus(surfaces);
    return json({
      surfaces,
      provider: provider.id,
      auditor: auditor?.id ?? null,
      auditorModel: auditor?.model ?? null,
      auditedOpenings: auditedOpenings.length,
      acceptedOpenings,
      inferredOpeningThresholds,
      shellGeometryStatus,
      openingAuditAttempts,
      openingAuditStatus: auditor
        ? inferredOpeningThresholds ? 'geometry-invalid'
          : acceptedOpenings ? 'verified'
            : auditedOpenings.length ? 'geometry-invalid'
              : seedOpenings.length ? 'candidate-unverified'
                : 'none-found'
        : 'unavailable',
    }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a riconoscere la geometria della stanza.',
    }, headers, 500);
  }
}
