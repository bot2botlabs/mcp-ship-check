export const allowedOrigins = ['https://app.example.com', '*'];
export function ok(o: string) { return allowedOrigins.includes(o) || allowedOrigins.includes('*'); }
