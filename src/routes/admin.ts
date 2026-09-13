import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import os from 'os';
import { validate } from '../middleware/validation';
import { adminAuth, generateAdminToken } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import prisma from '../config/database';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';
import { PrintJobStatus } from '../types';

const router = Router();

router.get('/network-info', (_req: Request, res: Response) => {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  let primaryIp = 'localhost';

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
        // Prefer 192.168.x.x or 10.x.x.x over APIPA (169.254.x.x)
        if (iface.address.startsWith('192.168.') || iface.address.startsWith('10.')) {
          primaryIp = iface.address;
        }
      }
    }
  }

  // Fallback to first IP if no private IP found
  if (primaryIp === 'localhost' && ips.length > 0) {
    primaryIp = ips[0];
  }

  res.json({
    success: true,
    data: {
      hostname: os.hostname(),
      ips,
      primaryIp,
    },
  });
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', authLimiter, validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    let admin = await prisma.adminUser.findUnique({ where: { username } });

    if (!admin) {
      if (username === config.admin.username) {
        const passwordHash = await bcrypt.hash(config.admin.password, 12);
        admin = await prisma.adminUser.create({
          data: {
            username,
            passwordHash,
            role: 'ADMIN',
          },
        });
      } else {
        throw new AppError('Invalid credentials', 401);
      }
    }

    const isValidPassword = await bcrypt.compare(password, admin.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Invalid credentials', 401);
    }

    const token = generateAdminToken({
      userId: admin.id,
      username: admin.username,
      role: admin.role,
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
        },
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/dashboard', adminAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      todayJobs,
      todayPages,
      todayRevenueResult,
      activePrinters,
      failedJobs,
      stationCount,
      printerCount,
      revenueChart,
      recentJobs,
    ] = await Promise.all([
      prisma.printJob.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.printJob.aggregate({
        where: { createdAt: { gte: todayStart } },
        _sum: { pageCount: true },
      }),
      prisma.paymentTransaction.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      prisma.printer.count({ where: { isOnline: true } }),
      prisma.printJob.count({ where: { printStatus: { in: [PrintJobStatus.PRINT_FAILED, PrintJobStatus.PRINTER_ERROR] } } }),
      prisma.station.count({ where: { isActive: true } }),
      prisma.printer.count(),
      (async () => {
        const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const txns = await prisma.paymentTransaction.findMany({
          where: { status: 'SUCCESS', createdAt: { gte: weekAgo } },
          select: { amount: true, createdAt: true },
        });
        const byDate = new Map<string, number>();
        for (const t of txns) {
          const d = t.createdAt.toISOString().slice(0, 10);
          byDate.set(d, (byDate.get(d) || 0) + t.amount);
        }
        return Array.from(byDate.entries()).map(([date, revenue]) => ({ date, revenue })).sort((a, b) => a.date.localeCompare(b.date));
      })(),
      prisma.printJob.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { station: true, printer: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        todayJobs,
        todayPages: todayPages._sum.pageCount || 0,
        todayRevenue: todayRevenueResult._sum.amount || 0,
        activePrinters,
        failedJobs,
        recentJobs,
        revenueChart,
        stationCount,
        printerCount,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/jobs', adminAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string | undefined;
    const stationId = req.query.stationId as string | undefined;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.printStatus = status;
    if (stationId) where.stationId = stationId;

    const [jobs, total] = await Promise.all([
      prisma.printJob.findMany({
        where,
        include: { station: true, printer: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.printJob.count({ where }),
    ]);

    res.json({
      success: true,
      data: jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/printers', adminAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const stationId = req.query.stationId as string | undefined;
    const skip = (page - 1) * limit;

    const where: Record<string, string> = {};
    if (stationId) where.stationId = stationId;

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

    res.json({
      success: true,
      data: printers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/stations', adminAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const [stations, total] = await Promise.all([
      prisma.station.findMany({
        include: {
          printers: true,
          _count: { select: { jobs: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.station.count(),
    ]);

    res.json({
      success: true,
      data: stations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/revenue', adminAuth, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [totalRevenue, totalTransactions, transactions] = await Promise.all([
      prisma.paymentTransaction.aggregate({
        where: { status: 'SUCCESS', createdAt: { gte: startDate } },
        _sum: { amount: true },
      }),
      prisma.paymentTransaction.count({
        where: { status: 'SUCCESS', createdAt: { gte: startDate } },
      }),
      prisma.paymentTransaction.findMany({
        where: { status: 'SUCCESS', createdAt: { gte: startDate } },
        select: { amount: true, createdAt: true, job: { select: { stationId: true, station: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Build revenue by day
    const byDate = new Map<string, number>();
    for (const t of transactions) {
      const d = t.createdAt.toISOString().slice(0, 10);
      byDate.set(d, (byDate.get(d) || 0) + t.amount);
    }
    const revenueByDay = Array.from(byDate.entries())
      .map(([date, revenue]) => ({ date, revenue, transactions: 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Build revenue by station
    const byStation = new Map<string, { stationName: string; revenue: number; jobs: number }>();
    for (const t of transactions) {
      const stationId = t.job?.stationId || 'unknown';
      const stationName = t.job?.station?.name || 'Unknown';
      const existing = byStation.get(stationId) || { stationName, revenue: 0, jobs: 0 };
      existing.revenue += t.amount;
      existing.jobs += 1;
      byStation.set(stationId, existing);
    }
    const revenueByStation = Array.from(byStation.entries())
      .map(([stationId, data]) => ({ stationId, ...data }))
      .sort((a, b) => b.revenue - a.revenue);

    res.json({
      success: true,
      data: {
        totalRevenue: totalRevenue._sum.amount || 0,
        totalTransactions,
        revenueByDay,
        revenueByStation,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/alerts', adminAuth, async (_req: Request, res: Response) => {
  try {
    const alerts = [];

    const offlinePrinters = await prisma.printer.findMany({
      where: { isOnline: false },
      include: { station: true },
    });

    for (const printer of offlinePrinters) {
      alerts.push({
        id: `printer-offline-${printer.id}`,
        type: 'PRINTER_OFFLINE',
        severity: 'WARNING',
        message: `Printer "${printer.name}" at ${printer.station.name} is offline`,
        entityId: printer.id,
        entityType: 'Printer',
        createdAt: printer.updatedAt,
      });
    }

    const errorPrinters = await prisma.printer.findMany({
      where: { currentState: 'ERROR' },
      include: { station: true },
    });

    for (const printer of errorPrinters) {
      alerts.push({
        id: `printer-error-${printer.id}`,
        type: 'PRINTER_ERROR',
        severity: 'CRITICAL',
        message: `Printer "${printer.name}" at ${printer.station.name} is in error state`,
        entityId: printer.id,
        entityType: 'Printer',
        createdAt: printer.updatedAt,
      });
    }

    const lowPaperPrinters = await prisma.printer.findMany({
      where: { paperStatus: 'LOW' },
      include: { station: true },
    });

    for (const printer of lowPaperPrinters) {
      alerts.push({
        id: `low-paper-${printer.id}`,
        type: 'LOW_PAPER',
        severity: 'INFO',
        message: `Printer "${printer.name}" at ${printer.station.name} is low on paper`,
        entityId: printer.id,
        entityType: 'Printer',
        createdAt: printer.updatedAt,
      });
    }

    const lowTonerPrinters = await prisma.printer.findMany({
      where: { tonerStatus: 'LOW' },
      include: { station: true },
    });

    for (const printer of lowTonerPrinters) {
      alerts.push({
        id: `low-toner-${printer.id}`,
        type: 'LOW_TONER',
        severity: 'INFO',
        message: `Printer "${printer.name}" at ${printer.station.name} is low on toner`,
        entityId: printer.id,
        entityType: 'Printer',
        createdAt: printer.updatedAt,
      });
    }

    alerts.sort((a, b) => {
      const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      return (severityOrder[a.severity as keyof typeof severityOrder] || 2) -
             (severityOrder[b.severity as keyof typeof severityOrder] || 2);
    });

    res.json({ success: true, data: alerts });
  } catch (error) {
    throw error;
  }
});

router.post('/alerts/:id/acknowledge', adminAuth, async (req: Request, res: Response) => {
  res.json({ success: true, data: { id: req.params.id, acknowledged: true } });
});

router.delete('/alerts/:id', adminAuth, async (req: Request, res: Response) => {
  res.json({ success: true, data: { id: req.params.id, dismissed: true } });
});

export default router;
