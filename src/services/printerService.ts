import { PrinterState, PaperStatus, TonerStatus } from '../types';
import { NotFoundError, BadRequestError } from '../middleware/errorHandler';
import prisma from '../config/database';

export async function createPrinter(params: {
  name: string;
  stationId: string;
  printerUri: string;
  adapterType?: string;
}) {
  const station = await prisma.station.findUnique({ where: { id: params.stationId } });
  if (!station) {
    throw new NotFoundError('Station', params.stationId);
  }

  return prisma.printer.create({
    data: {
      name: params.name,
      stationId: params.stationId,
      printerUri: params.printerUri,
      adapterType: (params.adapterType as 'WINDOWS' | 'CUPS' | 'IPP' | 'VIRTUAL') || 'WINDOWS',
    },
    include: { station: true },
  });
}

export async function getPrinterById(id: string) {
  const printer = await prisma.printer.findUnique({
    where: { id },
    include: { station: true },
  });
  if (!printer) {
    throw new NotFoundError('Printer', id);
  }
  return printer;
}

export async function listPrinters(stationId?: string, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  const where = stationId ? { stationId } : {};

  const [printers, total] = await Promise.all([
    prisma.printer.findMany({
      where,
      include: { station: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.printer.count({ where }),
  ]);

  return {
    printers,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function updatePrinterStatus(
  printerId: string,
  status: {
    isOnline?: boolean;
    currentState?: PrinterState;
    paperStatus?: PaperStatus;
    paperLevel?: number;
    tonerStatus?: TonerStatus;
    tonerLevel?: number;
  }
) {
  const printer = await prisma.printer.findUnique({ where: { id: printerId } });
  if (!printer) {
    throw new NotFoundError('Printer', printerId);
  }

  return prisma.printer.update({
    where: { id: printerId },
    data: {
      ...status,
      lastSeenAt: new Date(),
    },
    include: { station: true },
  });
}

export async function getPrintersByStation(stationId: string) {
  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) {
    throw new NotFoundError('Station', stationId);
  }

  return prisma.printer.findMany({
    where: { stationId },
    orderBy: { name: 'asc' },
  });
}

export async function getAvailablePrinter(stationId: string, colorMode: string) {
  const printer = await prisma.printer.findFirst({
    where: {
      stationId,
      isOnline: true,
      currentState: PrinterState.IDLE,
      paperStatus: { not: PaperStatus.EMPTY },
    },
    orderBy: { name: 'asc' },
  });

  return printer;
}

export async function updatePrinterOffline(printerId: string) {
  return prisma.printer.update({
    where: { id: printerId },
    data: {
      isOnline: false,
      currentState: PrinterState.OFFLINE,
    },
  });
}

export async function deletePrinter(id: string) {
  const printer = await prisma.printer.findUnique({ where: { id } });
  if (!printer) {
    throw new NotFoundError('Printer', id);
  }

  const activeJobs = await prisma.printJob.count({
    where: {
      printerId: id,
      printStatus: { in: ['PRINTING', 'QUEUED'] },
    },
  });

  if (activeJobs > 0) {
    throw new BadRequestError('Cannot delete printer with active jobs');
  }

  return prisma.printer.delete({ where: { id } });
}
