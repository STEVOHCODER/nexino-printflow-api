import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testConnection() {
  try {
    await prisma.$connect();
    console.log('Connected to MongoDB Atlas via Prisma!');
    
    const result = await prisma.$runCommandRaw({ ping: 1 });
    console.log('Ping result:', result);

    const stationCount = await prisma.station.count();
    console.log('Stations in DB:', stationCount);

    await prisma.$disconnect();
    console.log('Success!');
  } catch (error) {
    console.error('Connection error:', error);
    process.exit(1);
  }
}

testConnection();
