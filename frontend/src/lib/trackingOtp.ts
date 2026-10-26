import crypto from 'crypto';

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required to protect delivery OTP values.');
  return crypto.createHash('sha256').update(secret).digest();
}

export function generateDeliveryOtp() { return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); }

export function hashDeliveryOtp(orderId: string, phase: 'pickup' | 'delivery', otp: string) {
  return crypto.createHmac('sha256', key()).update(`${orderId}:${phase}:${otp}`).digest('hex');
}

export function encryptDeliveryOtp(otp: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(otp, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptDeliveryOtp(value: string) {
  const [iv, tag, ciphertext] = value.split('.');
  if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted OTP.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function verifyDeliveryOtp(orderId: string, phase: 'pickup' | 'delivery', otp: string, expected: string) {
  const actual = Buffer.from(hashDeliveryOtp(orderId, phase, otp), 'hex');
  const stored = Buffer.from(expected, 'hex');
  return actual.length === stored.length && crypto.timingSafeEqual(actual, stored);
}

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
