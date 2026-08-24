const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

type ProductResult = {
  name: string;
  brand: string;
  category: 'Pavimenti' | 'Rivestimenti' | 'Colori' | 'Arredi';
  description: string;
  sourceUrl: string;
  imageUrl: string;
};

function responseText(payload: { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  if (payload.output_text) return payload.output_text;
  return payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text ?? '';
}

function parseProducts(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned) as { products?: ProductResult[] };
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({
      code: 'not_configured',
      message: 'La ricerca internet è pronta ma manca la chiave OpenAI protetta sul server.',
    }, 503);
  }

  try {
    const body = await request.json() as { query?: string };
    const query = String(body.query ?? '').trim().slice(0, 300);
    if (query.length < 3) return json({ message: 'Scrivi almeno tre caratteri.' }, 400);

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        tools: [{ type: 'web_search_preview' }],
        input: [
          'Search the public web for real interior-design products matching the user query.',
          'Prioritize the exact brand, collection, finish and dimensions. Return only products supported by a manufacturer, retailer or official catalog page.',
          `User query: ${query}`,
          'Return JSON only: {"products":[{"name":"...","brand":"...","category":"Pavimenti|Rivestimenti|Colori|Arredi","description":"...","sourceUrl":"https://...","imageUrl":"https://... or empty"}]}. Return at most 6 items and an empty array when no reliable match exists.',
        ].join('\n'),
      }),
    });
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; error?: { message?: string } };
    if (!response.ok) return json({ message: payload.error?.message ?? 'Ricerca non disponibile.' }, response.status);

    const parsed = parseProducts(responseText(payload));
    const products = (parsed.products ?? []).slice(0, 6).filter((item) => {
      try { return Boolean(item.name && item.brand && new URL(item.sourceUrl).protocol.startsWith('http')); } catch { return false; }
    }).map((item) => ({ ...item, imageUrl: /^https?:\/\//.test(item.imageUrl) ? item.imageUrl : '' }));
    return json({ products });
  } catch {
    return json({ message: 'Non sono riuscito a cercare i prodotti. Riprova tra poco.' }, 500);
  }
}
