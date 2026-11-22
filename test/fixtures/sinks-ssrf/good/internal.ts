import { z } from 'zod';
const ENDPOINTS = { a: { tokenUrl: 'https://auth.acme.test/token' } };
const Dir = z.object({ url: z.string() });
export async function exchange(input: { provider: 'a'; code: string }) {
  return fetch(ENDPOINTS[input.provider].tokenUrl, { method: 'POST' });
}
class Session {
  private async send(url: string, init: RequestInit) { return fetch(url, init); }
}
