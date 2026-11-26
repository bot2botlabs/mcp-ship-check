const ALLOWED = ['https://app.example.com/cb', 'https://app.example.com/cb2'];
export function check(redirectUri: string) {
  if (!ALLOWED.includes(redirectUri)) throw new Error('bad');  // exact allowlist -> safe
  return redirectUri;
}
