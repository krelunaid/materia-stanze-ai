import { acceptsRoomCleanup, getAiProvider, getRenderProvider, getVisionAuditor, verifyRoomCleanup } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'verify-cleanup');
  if (!access.ok) return access.response;
  const { headers } = access;
  const primary = getAiProvider();
  const provider = getVisionAuditor(process.env, primary) ?? primary ?? getRenderProvider();
  if (!provider) return json({ message: 'Il controllo fotografico non è momentaneamente disponibile.' }, headers, 503);

  try {
    const incoming = await request.formData();
    const source = incoming.get('source');
    const rendered = incoming.get('rendered');
    const maskReference = incoming.get('maskReference');
    const targetDescription = String(incoming.get('targetDescription') ?? 'mobili indicati').slice(0, 12000);
    if (!(source instanceof File) || !source.type.startsWith('image/') || source.size > 20 * 1024 * 1024) {
      return json({ message: 'La fotografia originale non è valida.' }, headers, 400);
    }
    if (!(rendered instanceof File) || !rendered.type.startsWith('image/') || rendered.size > 20 * 1024 * 1024) {
      return json({ message: 'La fotografia pulita non è valida.' }, headers, 400);
    }
    if (maskReference != null && (!(maskReference instanceof File) || maskReference.type !== 'image/png' || maskReference.size > 8 * 1024 * 1024)) {
      return json({ message: 'La guida delle aree autorizzate non è valida.' }, headers, 400);
    }
    const verification = await verifyRoomCleanup(provider, {
      source, renderedFile: rendered, targetDescription,
      maskReferenceFile: maskReference instanceof File ? maskReference : undefined,
    });
    if (!acceptsRoomCleanup(verification)) {
      return json({
        code: 'cleanup_quality_rejected',
        message: 'La pulizia non ha mantenuto perfettamente inquadratura, pareti e aperture. Ho lasciato intatta la foto originale: riprova oppure indica un mobile alla volta.',
        checks: {
          sameCameraAndCrop: verification.sameCameraAndCrop,
          sameArchitecture: verification.sameArchitecture,
          openingsPreserved: verification.openingsPreserved,
          removableTargetsRemoved: verification.removableTargetsRemoved,
          noVisiblePatchArtifacts: verification.noVisiblePatchArtifacts,
          noNewObjects: verification.noNewObjects,
          realisticContinuation: verification.realisticContinuation,
          confidence: verification.confidence,
        },
      }, headers, 422);
    }
    return json({ accepted: true, verification }, headers);
  } catch (caught) {
    const record = caught && typeof caught === 'object' ? caught as { message?: unknown; name?: unknown } : null;
    const message = String(record?.message ?? '');
    const timedOut = /abort|timeout|timed out/i.test(`${record?.name ?? ''} ${message}`);
    return json({
      message: timedOut
        ? 'Il controllo fotografico ha impiegato troppo tempo. La foto originale è rimasta intatta: riprova oppure indica un mobile alla volta.'
        : 'Non sono riuscito a verificare la pulizia. La foto originale è rimasta intatta: riprova tra poco.',
    }, headers, 500);
  }
}
