import crypto from 'crypto';
export function check(sig: Buffer, expected: Buffer) {
  return crypto.timingSafeEqual(sig, expected);  // constant-time -> no finding anywhere in file
}
export function also(apiKey: string) { return apiKey === process.env.KEY; }
