import {
  detectArchitecturalOpenings,
  detectRoomSurfaces,
  getAiProvider,
  getVisionAuditor,
  mergeArchitecturalOpeningAudit,
} from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
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
    const [primaryResult, auditResult] = await Promise.allSettled([
      detectRoomSurfaces(provider, image, { openingAudit: true, source: 'photo' }),
      auditor ? detectArchitecturalOpenings(auditor, image) : Promise.resolve([]),
    ]);
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
    const auditedOpenings = auditResult.status === 'fulfilled' ? auditResult.value : [];
    const surfaces = auditedOpenings.length
      ? mergeArchitecturalOpeningAudit(primaryResult.value, auditedOpenings)
      : primaryResult.value;
    return json({
      surfaces,
      provider: provider.id,
      auditor: auditor?.id ?? null,
      auditorModel: auditor?.model ?? null,
      auditedOpenings: auditedOpenings.length,
    }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a riconoscere la geometria della stanza.',
    }, headers, 500);
  }
}
