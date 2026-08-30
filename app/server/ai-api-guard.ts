import { aiRateLimitSchema, aiRateLimitUpdatedAtIndex } from '../../db/schema';

type AiRoute = 'apply-product' | 'classify-product' | 'clean-product' | 'clean-room-region' | 'detect-object' | 'detect-surfaces' | 'empty-room' | 'render-room' | 'search-products';

type LimitPolicy = {
  hourly: number;
  daily: number;
};

type RateLimitRow = {
  request_count: number;
};

type GuardSuccess = {
  ok: true;
  headers: Headers;
};

type GuardFailure = {
  ok: false;
  response: Response;
};

const HOSTED_ORIGIN = 'https://materia-stanze-ai.andreagadducci.chatgpt.site';
const NATIVE_ORIGIN = 'capacitor://localhost';

const policies: Record<AiRoute, LimitPolicy> = {
  'apply-product': { hourly: 8, daily: 24 },
  'classify-product': { hourly: 20, daily: 60 },
  'clean-product': { hourly: 12, daily: 36 },
  'clean-room-region': { hourly: 16, daily: 48 },
  'detect-object': { hourly: 24, daily: 72 },
  'detect-surfaces': { hourly: 20, daily: 60 },
  'empty-room': { hourly: 6, daily: 18 },
  'render-room': { hourly: 6, daily: 18 },
  'search-products': { hourly: 30, daily: 90 },
};

function configuredSiteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return HOSTED_ORIGIN;
  try {
    return new URL(configured).origin;
  } catch {
    return HOSTED_ORIGIN;
  }
}

export function isAllowedAiOrigin(origin: string | null) {
  if (!origin) return false;
  if (origin === configuredSiteOrigin() || origin === HOSTED_ORIGIN || origin === NATIVE_ORIGIN) return true;
  if (process.env.NODE_ENV !== 'production') {
    try {
      const url = new URL(origin);
      return ['localhost', '127.0.0.1'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  }
  return false;
}

export function isAllowedAiRequest(request: Request) {
  if (isAllowedAiOrigin(request.headers.get('Origin'))) return true;
  // CapacitorHttp performs iOS requests through CFNetwork. Unlike WKWebView
  // fetch it intentionally strips Origin. Build 23+ also sends the explicit
  // app header; accept the distinctive legacy App/… CFNetwork transport so
  // already-installed TestFlight builds keep working during the rollout.
  const userAgent = request.headers.get('User-Agent') ?? '';
  const nativeTransport = /^App\/\d+\s+CFNetwork\//i.test(userAgent);
  return nativeTransport && (
    request.headers.get('X-Materia-Client') === 'capacitor-ios'
    || !request.headers.has('X-Materia-Client')
  );
}

export function aiCorsHeaders(request: Request, methods = 'POST, OPTIONS') {
  const headers = new Headers({
    'Access-Control-Allow-Methods': methods,
    // Older TestFlight builds may still send the former Sites header. It is
    // accepted for CORS compatibility only and is never treated as authority.
    'Access-Control-Allow-Headers': 'Content-Type, OAI-Sites-Authorization, X-Materia-Client',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  });
  const origin = request.headers.get('Origin');
  if (isAllowedAiOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin!);
  return headers;
}

export function handleAiOptions(request: Request, methods = 'POST, OPTIONS') {
  const headers = aiCorsHeaders(request, methods);
  if (!headers.has('Access-Control-Allow-Origin')) {
    return Response.json({ code: 'origin_denied', message: 'Origine dell’app non autorizzata.' }, { status: 403, headers });
  }
  headers.set('Access-Control-Max-Age', '600');
  return new Response(null, { status: 204, headers });
}

function deniedOrigin(request: Request) {
  return Response.json(
    { code: 'origin_denied', message: 'Questa richiesta non proviene dall’app Materia.' },
    { status: 403, headers: aiCorsHeaders(request) },
  );
}

async function clientHash(request: Request) {
  const forwarded = request.headers.get('CF-Connecting-IP')
    ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    ?? 'unknown';
  const userAgent = request.headers.get('User-Agent')?.slice(0, 160) ?? 'unknown';
  const bytes = new TextEncoder().encode(`${forwarded}|${userAgent}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bucketFor(now: number, durationMs: number) {
  return Math.floor(now / durationMs).toString(36);
}

async function databaseBinding() {
  const workers = await import('cloudflare:workers');
  return (workers.env as unknown as { DB?: D1Database }).DB;
}

async function initializeRateLimits(database: D1Database) {
  await database.batch([
    database.prepare(aiRateLimitSchema),
    database.prepare(aiRateLimitUpdatedAtIndex),
  ]);
}

async function increment(
  database: D1Database,
  bucket: string,
  hash: string,
  route: string,
  now: number,
) {
  const result = await database.prepare(`
    INSERT INTO ai_rate_limits (bucket, client_hash, route, request_count, updated_at)
    VALUES (?, ?, ?, 1, ?)
    ON CONFLICT (bucket, client_hash, route)
    DO UPDATE SET request_count = request_count + 1, updated_at = excluded.updated_at
    RETURNING request_count
  `).bind(bucket, hash, route, now).run<RateLimitRow>();
  return Number(result.results[0]?.request_count ?? 1);
}

export async function guardAiRequest(request: Request, route: AiRoute): Promise<GuardSuccess | GuardFailure> {
  if (!isAllowedAiRequest(request)) return { ok: false, response: deniedOrigin(request) };

  const headers = aiCorsHeaders(request);
  try {
    const database = await databaseBinding();
    if (!database) throw new Error('D1 binding DB is unavailable');
    await initializeRateLimits(database);

    const now = Date.now();
    const hash = await clientHash(request);
    const policy = policies[route];
    const hourMs = 60 * 60 * 1000;
    const dayMs = 24 * hourMs;
    const [hourlyCount, dailyCount] = await Promise.all([
      increment(database, `h:${bucketFor(now, hourMs)}`, hash, route, now),
      increment(database, `d:${bucketFor(now, dayMs)}`, hash, route, now),
    ]);
    const remaining = Math.max(0, Math.min(policy.hourly - hourlyCount, policy.daily - dailyCount));
    const resetSeconds = Math.ceil((hourMs - (now % hourMs)) / 1000);
    headers.set('X-RateLimit-Limit', String(policy.hourly));
    headers.set('X-RateLimit-Remaining', String(remaining));
    headers.set('X-RateLimit-Reset', String(resetSeconds));

    if (hourlyCount > policy.hourly || dailyCount > policy.daily) {
      headers.set('Retry-After', String(resetSeconds));
      return {
        ok: false,
        response: Response.json({
          code: 'rate_limited',
          message: 'Hai raggiunto il limite temporaneo delle elaborazioni IA. Riprova più tardi.',
        }, { status: 429, headers }),
      };
    }
    return { ok: true, headers };
  } catch (error) {
    console.error(JSON.stringify({ event: 'ai_rate_limit_unavailable', route, message: error instanceof Error ? error.message : 'unknown' }));
    return {
      ok: false,
      response: Response.json({
        code: 'protection_unavailable',
        message: 'La protezione del servizio IA non è momentaneamente disponibile. Riprova tra poco.',
      }, { status: 503, headers }),
    };
  }
}
