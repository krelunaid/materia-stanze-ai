import { enrichFurnitureProductImages, getAiProvider, knownRetailerProductImage, readProductPage, searchMaterials } from '../../server/ai-provider';
import { guardAiRequest, handleAiOptions } from '../../server/ai-api-guard';

function json(body: unknown, headers: Headers, status = 200) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request: Request) {
  return handleAiOptions(request);
}

export async function POST(request: Request) {
  const access = await guardAiRequest(request, 'search-products');
  if (!access.ok) return access.response;
  const { headers } = access;
  const provider = getAiProvider();
  if (!provider) {
    return json({
      code: 'not_configured',
      message: 'Il servizio IA del server non è momentaneamente disponibile.',
    }, headers, 503);
  }

  try {
    const body = await request.json() as { query?: string; criteria?: { brand?: string; model?: string; color?: string; category?: string; sourceUrl?: string } };
    const query = String(body.query ?? '').trim().slice(0, 300);
    const allowedCategories = new Set(['Pavimenti', 'Rivestimenti', 'Colori', 'Arredi']);
    const brand = String(body.criteria?.brand ?? '').trim().slice(0, 100);
    const model = String(body.criteria?.model ?? '').trim().slice(0, 100);
    const color = String(body.criteria?.color ?? '').trim().slice(0, 100);
    const categoryCandidate = String(body.criteria?.category ?? '').trim();
    const category = allowedCategories.has(categoryCandidate) ? categoryCandidate as 'Pavimenti' | 'Rivestimenti' | 'Colori' | 'Arredi' : '';
    const sourceUrlCandidate = String(body.criteria?.sourceUrl ?? '').trim().slice(0, 500);
    let sourceUrl = '';
    if (sourceUrlCandidate) {
      try {
        const parsed = new URL(sourceUrlCandidate);
        if (parsed.protocol === 'https:' || parsed.protocol === 'http:') sourceUrl = parsed.toString();
      } catch { /* The provider receives only valid public URL syntax. */ }
    }
    const structuredQuery = [
      brand ? `Marca o produttore: ${brand}` : '',
      model ? `Modello o collezione: ${model}` : '',
      color ? `Colore richiesto: ${color}` : '',
      category ? `Tipo prodotto: ${category}` : '',
      query ? `Altri dettagli: ${query}` : '',
      sourceUrl ? `Pagina prodotto esatta: ${sourceUrl}` : '',
    ].filter(Boolean).join('\n');
    if (structuredQuery.length < 3) return json({ message: 'Inserisci almeno un criterio di ricerca.' }, headers, 400);
    const directProducts = sourceUrl ? await readProductPage(sourceUrl, category || 'Arredi') : [];
    const searchedProducts = directProducts.length ? directProducts : await searchMaterials(provider, structuredQuery);
    const enrichedProducts = await enrichFurnitureProductImages(searchedProducts);
    const products = enrichedProducts.map((product) => ({
      ...product,
      productImageUrl: product.productImageUrl || knownRetailerProductImage(product.sourceUrl || sourceUrl),
    }));
    return json({ products, provider: provider.id }, headers);
  } catch (caught) {
    return json({
      message: caught instanceof Error ? caught.message : 'Non sono riuscito a cercare i prodotti. Riprova tra poco.',
    }, headers, 500);
  }
}
