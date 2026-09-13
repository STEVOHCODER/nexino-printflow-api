import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

function requireSecret(name: string, fallback?: string): string {
  const val = process.env[name] || fallback;
  if (!val || val.startsWith('change-me') || val === 'nexino123') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`FATAL: ${name} must be set to a secure value in production`);
    }
    console.warn(`WARNING: Using default ${name}. Set a secure value for production.`);
  }
  return val || '';
}

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'mongodb://localhost:27017/nexino_printflow',
  jwtSecret: requireSecret('JWT_SECRET', crypto.randomBytes(32).toString('hex')),
  agentSecret: requireSecret('AGENT_SECRET', crypto.randomBytes(32).toString('hex')),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10),
  pricing: {
    perPageBw: parseInt(process.env.PRICE_PER_PAGE_BW || '100', 10),
    perPageColor: parseInt(process.env.PRICE_PER_PAGE_COLOR || '300', 10),
  },
  currency: process.env.CURRENCY || 'RWF',
  retentionHours: parseInt(process.env.RETENTION_HOURS || '24', 10),
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  mockPaymentEnabled: process.env.MOCK_PAYMENT_ENABLED === 'true',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
  },
};
