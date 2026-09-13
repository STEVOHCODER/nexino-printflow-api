import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const adminPasswordHash = await bcrypt.hash('admin123', 12);
  await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
    },
  });
  console.log('Admin user created');

  const stations = [
    { stationCode: 'STATION-001', name: 'Station 001', location: 'Main Office' },
    { stationCode: 'DEMO01', name: 'Demo Station', location: 'Kigali, Rwanda' },
  ];

  for (const s of stations) {
    const station = await prisma.station.upsert({
      where: { stationCode: s.stationCode },
      update: {},
      create: { ...s, isActive: true },
    });
    console.log(`Station created: ${station.name} (${station.stationCode})`);

    const existingPrinter = await prisma.printer.findFirst({ where: { stationId: station.id } });
    if (!existingPrinter) {
      await prisma.printer.create({
        data: {
          name: `${s.name} Printer`,
          stationId: station.id,
          printerUri: 'virtual://default-printer',
          adapterType: 'VIRTUAL',
          isOnline: true,
          currentState: 'IDLE',
          paperStatus: 'OK',
          paperLevel: 85,
          tonerStatus: 'OK',
          tonerLevel: 70,
        },
      });
      console.log(`  Printer created for ${s.stationCode}`);
    }
  }

  await prisma.systemConfig.upsert({
    where: { key: 'system_name' },
    update: {},
    create: { key: 'system_name', value: 'Nexino PrintFlow' },
  });

  await prisma.systemConfig.upsert({
    where: { key: 'version' },
    update: {},
    create: { key: 'version', value: '1.0.0' },
  });

  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
