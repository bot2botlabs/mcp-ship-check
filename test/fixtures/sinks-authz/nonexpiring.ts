import jwt from 'jsonwebtoken';
export function mint(user: string) {
  return jwt.sign({ sub: user, role: 'admin' }, process.env.SECRET!);
}
