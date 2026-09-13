import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export function generateJobId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JOB-${result}`;
}

export function generateAuthorizationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateIdempotencyKey(): string {
  return uuidv4();
}

export function generateChecksum(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function generateStationCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
