export function check(redirectUri: string, base: string) {
  if (!redirectUri.startsWith(base)) throw new Error('bad redirect');
  return redirectUri;
}
