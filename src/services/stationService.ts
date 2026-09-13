import QRCode from 'qrcode';
import { generateStationCode } from '../utils/idGenerator';
import { NotFoundError, BadRequestError } from '../middleware/errorHandler';
import prisma from '../config/database';
import { generateStationToken } from '../middleware/auth';
import { config } from '../config';

export async function createStation(params: {
  name: string;
  location: string;
  isActive?: boolean;
}) {
  const stationCode = generateStationCode();

  const station = await prisma.station.create({
    data: {
      stationCode,
      name: params.name,
      location: params.location,
      isActive: params.isActive ?? true,
    },
  });

  const token = generateStationToken(station.id, station.stationCode);

  return { station, token };
}

export async function getStationById(id: string) {
  const station = await prisma.station.findUnique({
    where: { id },
    include: {
      printers: true,
      _count: {
        select: { jobs: true, files: true },
      },
    },
  });
  if (!station) {
    throw new NotFoundError('Station', id);
  }
  return {
    ...station,
    is_active: station.isActive,
    pricing: {
      price_per_page_bw: config.pricing.perPageBw,
      price_per_page_color: config.pricing.perPageColor,
      currency: config.currency,
    },
    settings: {
      max_file_size_mb: 50,
      allowed_formats: ['pdf'],
      max_copies: 10,
    },
  };
}

export async function getStationByCode(code: string) {
  const station = await prisma.station.findUnique({
    where: { stationCode: code },
    include: {
      printers: {
        where: { isOnline: true, currentState: 'IDLE' },
      },
      _count: {
        select: { jobs: true },
      },
    },
  });
  if (!station) {
    throw new NotFoundError('Station with code', code);
  }
  return station;
}

export async function listStations(page = 1, limit = 50, includeInactive = false) {
  const skip = (page - 1) * limit;
  const where = includeInactive ? {} : { isActive: true };

  const [stations, total] = await Promise.all([
    prisma.station.findMany({
      where,
      include: {
        printers: true,
        _count: {
          select: { jobs: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.station.count({ where }),
  ]);

  return {
    stations,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function updateStation(id: string, data: { name?: string; location?: string; isActive?: boolean }) {
  const station = await prisma.station.findUnique({ where: { id } });
  if (!station) {
    throw new NotFoundError('Station', id);
  }

  return prisma.station.update({
    where: { id },
    data,
    include: { printers: true },
  });
}

export async function deleteStation(id: string) {
  const station = await prisma.station.findUnique({ where: { id } });
  if (!station) {
    throw new NotFoundError('Station', id);
  }

  const activeJobs = await prisma.printJob.count({
    where: {
      stationId: id,
      printStatus: { in: ['PRINTING', 'QUEUED', 'AWAITING_PAYMENT', 'PAYMENT_PROCESSING'] },
    },
  });

  if (activeJobs > 0) {
    throw new BadRequestError('Cannot delete station with active jobs');
  }

  const printerCount = await prisma.printer.count({ where: { stationId: id } });
  if (printerCount > 0) {
    throw new BadRequestError('Cannot delete station with assigned printers. Remove printers first.');
  }

  return prisma.station.delete({ where: { id } });
}

export async function generateStationQR(stationId: string): Promise<string> {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) {
    throw new NotFoundError('Station', stationId);
  }

  const printUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/print/${station.stationCode}`;

  const qrDataUrl = await QRCode.toDataURL(printUrl, {
    width: 300,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  return qrDataUrl;
}

export async function getStationStats(stationId: string) {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) {
    throw new NotFoundError('Station', stationId);
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [totalJobs, todayJobs, totalRevenue, todayRevenue, onlinePrinters, totalPrinters] = await Promise.all([
    prisma.printJob.count({ where: { stationId } }),
    prisma.printJob.count({
      where: {
        stationId,
        createdAt: { gte: todayStart },
      },
    }),
    prisma.paymentTransaction.aggregate({
      where: {
        job: { stationId },
        status: 'SUCCESS',
      },
      _sum: { amount: true },
    }),
    prisma.paymentTransaction.aggregate({
      where: {
        job: { stationId },
        status: 'SUCCESS',
        createdAt: { gte: todayStart },
      },
      _sum: { amount: true },
    }),
    prisma.printer.count({
      where: { stationId, isOnline: true },
    }),
    prisma.printer.count({ where: { stationId } }),
  ]);

  return {
    totalJobs,
    todayJobs,
    totalRevenue: totalRevenue._sum.amount || 0,
    todayRevenue: todayRevenue._sum.amount || 0,
    onlinePrinters,
    totalPrinters,
  };
}
