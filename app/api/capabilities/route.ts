const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function GET() {
  return Response.json({ aiReady: Boolean(process.env.OPENAI_API_KEY) }, { headers: corsHeaders });
}
