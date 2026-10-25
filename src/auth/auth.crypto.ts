import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
function secret(name: string): Buffer {
  const value = process.env[name];
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error(`${name} doit contenir 64 caractères hexadécimaux`);
  return Buffer.from(value, 'hex');
}
export function hmac(value: string, key = 'AUTH_HMAC_KEY'): string {
  return createHmac('sha256', secret(key)).update(value).digest('hex');
}
export function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secret('AUTH_ENC_KEY'), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decrypt(value: string): string {
  const buf = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', secret('AUTH_ENC_KEY'), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex, ...rest] = stored.split(':');
  if (algo !== 'scrypt' || !saltHex || !hashHex || rest.length > 0) return false;

  const key = (await scrypt(password, Buffer.from(saltHex, 'hex'), 64)) as Buffer;
  const expected = Buffer.from(hashHex, 'hex');

  return key.length === expected.length && timingSafeEqual(key, expected);
}
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}
export function otpHash(challengeId: string, code: string): string {
  return hmac(`${challengeId}:${code}`, 'AUTH_OTP_KEY');
}
export function constantEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8'),
    y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}
