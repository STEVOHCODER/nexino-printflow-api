import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getDatabaseUrl(): string {
  let url = process.env.MONGODB_URI || process.env.DATABASE_URL || '';
  if (url && !url.includes('/nexino_printflow')) {
    url = url.replace('?appName=', '/nexino_printflow?appName=');
    if (!url.includes('appName')) {
      url += '/nexino_printflow';
    }
  }
  return url;
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
