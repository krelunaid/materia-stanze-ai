import { describe, expect, it } from 'vitest';
import { aiCorsHeaders, handleAiOptions, isAllowedAiOrigin, isAllowedAiRequest } from './ai-api-guard';

describe('AI API origin protection', () => {
  it('accepts the hosted site and the Capacitor iOS origin', () => {
    expect(isAllowedAiOrigin('https://materia-stanze-ai.andreagadducci.chatgpt.site')).toBe(true);
    expect(isAllowedAiOrigin('capacitor://localhost')).toBe(true);
  });

  it('rejects absent and unrelated origins', () => {
    expect(isAllowedAiOrigin(null)).toBe(false);
    expect(isAllowedAiOrigin('https://attacker.example')).toBe(false);
  });

  it('accepts an origin-less request only from the identified iOS native client', () => {
    expect(isAllowedAiRequest(new Request('https://example.test/api', { headers: {
      'X-Materia-Client': 'capacitor-ios',
      'User-Agent': 'App/22 CFNetwork/3860.600.12 Darwin/25.5.0',
    } }))).toBe(true);
    expect(isAllowedAiRequest(new Request('https://example.test/api', { headers: {
      'X-Materia-Client': 'capacitor-ios',
      'User-Agent': 'curl/8.0',
    } }))).toBe(false);
  });

  it('reflects only an allowed origin instead of using a wildcard', () => {
    const allowed = aiCorsHeaders(new Request('https://example.test/api', {
      headers: { Origin: 'capacitor://localhost' },
    }));
    const denied = aiCorsHeaders(new Request('https://example.test/api', {
      headers: { Origin: 'https://attacker.example' },
    }));
    expect(allowed.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
    expect(allowed.get('Access-Control-Allow-Headers')).toContain('OAI-Sites-Authorization');
    expect(denied.has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('rejects a preflight from an unrelated site', async () => {
    const response = handleAiOptions(new Request('https://example.test/api', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example' },
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'origin_denied' });
  });
});
