import jwt from 'jsonwebtoken';
export function mint(user: string) {
  return jwt.sign({ sub: user }, process.env.SECRET!, { expiresIn: '15m' });
}
