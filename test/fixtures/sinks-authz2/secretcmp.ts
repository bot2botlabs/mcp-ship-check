export function check(apiKey: string, token: string) {
  if (apiKey === process.env.API_KEY) return true;      // non-constant-time -> flag
  if (token === undefined || token === null) return false; // presence check -> not a secret compare
  return false;
}
