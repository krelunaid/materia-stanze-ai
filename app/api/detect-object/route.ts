import { auditRoomEmptyingNeed, detectMovableObjectRegions, detectObjectRegion, getAiProvider, getVisionAuditor, normalizeCleanupRegions } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'detect-object');
  if (!access.ok) return access.response;
  const { headers } = access;
  const provider = getAiProvider();
  if (!provider) return json({ code: 'not_configured', message: 'Il riconoscimento richiede Grok attivo sul server.' }, headers, 503);
  try {
    const incoming = await request.formData();
    const image = incoming.get('image');
    const mode = incoming.get('mode') === 'all' ? 'all' : 'point';
    const x = Number(incoming.get('x')); const y = Number(incoming.get('y'));
    if (!(image instanceof File) || !['image/jpeg', 'image/png'].includes(image.type)) return json({ message: 'La fotografia deve essere JPG o PNG.' }, headers, 400);
    if (!image.size || image.size > 20 * 1024 * 1024) return json({ message: 'La fotografia supera il limite di 20 MB.' }, headers, 413);
    if (mode === 'all') {
      const auditor = getVisionAuditor(process.env, provider);
      const [regionsResult, auditResult] = await Promise.allSettled([
        detectMovableObjectRegions(provider, image, 'real-estate-emptying'),
        auditor ? auditRoomEmptyingNeed(auditor, image) : Promise.resolve(null),
      ]);
      if (regionsResult.status === 'rejected') throw regionsResult.reason;
      const roomAudit = auditResult.status === 'fulfilled' ? auditResult.value : null;
      let regions = regionsResult.value;
      let localizationPasses = 1;
      if (roomAudit?.needsEmptying && roomAudit.confidence >= .75) {
        const expectedRegions = Math.min(10, Math.max(1, Math.ceil(roomAudit.removableObjectCount * .5)));
        if (regions.length < expectedRegions) {
          try {
            const focused = await detectMovableObjectRegions(provider, image, 'real-estate-emptying', roomAudit.majorCategories);
            regions = normalizeCleanupRegions([...regions, ...focused], .4);
            localizationPasses = 2;
          } catch {
            // Keep the first safe localization when the focused recovery is
            // temporarily unavailable.
          }
        }
      }
      return json({
        regions,
        roomAudit,
        localizationPasses,
        provider: provider.id,
        auditor: auditor?.id ?? null,
        auditorModel: auditor?.model ?? null,
      }, headers);
    }
    if (![x, y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return json({ message: 'Il punto selezionato non è valido.' }, headers, 400);
    const region = await detectObjectRegion(provider, image, { x, y }, 'explicit-target-removal');
    return json({ region, provider: provider.id }, headers);
  } catch (caught) {
    return json({ message: caught instanceof Error ? caught.message : 'Non sono riuscito a riconoscere l’oggetto.' }, headers, 500);
  }
}
