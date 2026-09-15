import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation';
import { agentAuth } from '../middleware/auth';
import { agentLimiter } from '../middleware/rateLimit';
import * as jobService from '../services/jobService';
import * as printerService from '../services/printerService';
import * as stationService from '../services/stationService';
import { auditService } from '../services/auditService';
import prisma from '../config/database';

const router = Router();

const registerSchema = z.object({
  agentId: z.string().min(1).max(100),
  stationId: z.string().uuid(),
  hostname: z.string().min(1),
  platform: z.string().min(1),
});

const autoRegisterSchema = z.object({
  agentId: z.string().min(1).max(100),
  hostname: z.string().min(1),
  platform: z.string().min(1),
  printers: z.array(z.object({
    name: z.string().min(1),
    driver: z.string().optional(),
    port: z.string().optional(),
    adapterType: z.enum(['WINDOWS', 'CUPS', 'IPP', 'VIRTUAL']).default('WINDOWS'),
  })).min(1),
});

const heartbeatSchema = z.object({
  agentId: z.string().min(1).max(100),
  stationId: z.string().uuid().optional(),
  printers: z.array(z.object({
    printerId: z.string().uuid(),
    status: z.enum(['IDLE', 'PRINTING', 'PAUSED', 'ERROR', 'OFFLINE']),
    paperStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
    paperLevel: z.number().int().min(0).max(100).nullable().optional(),
    tonerStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
    tonerLevel: z.number().int().min(0).max(100).nullable().optional(),
  })),
});

const jobStatusSchema = z.object({
  agentId: z.string().min(1).max(100),
  status: z.enum([
    'CREATED', 'FILE_UPLOADED', 'PRICE_CALCULATED', 'AWAITING_PAYMENT',
    'PAYMENT_PROCESSING', 'PAID', 'AUTHORIZED', 'QUEUED', 'PRINTING',
    'COMPLETED', 'PRINT_FAILED', 'PRINTER_OFFLINE', 'PRINTER_ERROR',
    'CANCELLED', 'REFUND_PENDING', 'REFUNDED',
  ]),
  errorMessage: z.string().optional(),
});

const printerStatusSchema = z.object({
  status: z.enum(['IDLE', 'PRINTING', 'PAUSED', 'ERROR', 'OFFLINE']),
  paperStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
  paperLevel: z.number().int().min(0).max(100).nullable().optional(),
  tonerStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
  tonerLevel: z.number().int().min(0).max(100).nullable().optional(),
});

router.post('/register', agentAuth, agentLimiter, validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { agentId, stationId, hostname, platform } = req.body;

    await auditService.log({
      action: 'AGENT_REGISTERED',
      entityType: 'Agent',
      entityId: agentId,
      details: { stationId, hostname, platform },
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: {
        agentId,
        stationId,
        status: 'registered',
        message: 'Agent registered successfully',
      },
    });
  } catch (error) {
    throw error;
  }
});

router.post('/auto-register', agentAuth, agentLimiter, validate(autoRegisterSchema), async (req: Request, res: Response) => {
  try {
    const { agentId, hostname, platform, printers: detectedPrinters } = req.body;

    const results = [];

    for (const printer of detectedPrinters) {
      const stationCode = `AGENT-${agentId}-${printer.name.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20)}`.toUpperCase();

      let station = await prisma.station.findUnique({ where: { stationCode } });

      if (!station) {
        station = await prisma.station.create({
          data: {
            stationCode,
            name: `${hostname} - ${printer.name}`,
            location: hostname,
            agentId,
            hostname,
            platform,
          },
        });

        await prisma.printer.create({
          data: {
            name: printer.name,
            stationId: station.id,
            printerUri: printer.port || `virtual://${printer.name}`,
            adapterType: printer.adapterType as any,
            isOnline: true,
            currentState: 'IDLE',
          },
        });

        await auditService.log({
          action: 'STATION_AUTO_CREATED',
          entityType: 'Station',
          entityId: station.id,
          details: { stationCode, agentId, printerName: printer.name },
          ipAddress: req.ip,
        });
      } else {
        station = await prisma.station.update({
          where: { id: station.id },
          data: {
            agentId,
            hostname,
            platform,
            isActive: true,
            updatedAt: new Date(),
          },
        });

        const existingPrinter = await prisma.printer.findFirst({
          where: { stationId: station.id, name: printer.name },
        });

        if (!existingPrinter) {
          await prisma.printer.create({
            data: {
              name: printer.name,
              stationId: station.id,
              printerUri: printer.port || `virtual://${printer.name}`,
              adapterType: printer.adapterType as any,
              isOnline: true,
              currentState: 'IDLE',
            },
          });
        } else {
          await prisma.printer.update({
            where: { id: existingPrinter.id },
            data: {
              isOnline: true,
              currentState: 'IDLE',
              lastSeenAt: new Date(),
            },
          });
        }
      }

      const printers = await prisma.printer.findMany({ where: { stationId: station.id } });

      results.push({
        stationId: station.id,
        stationCode: station.stationCode,
        name: station.name,
        printerName: printer.name,
        printers: printers.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })),
      });
    }

    res.json({
      success: true,
      data: {
        agentId,
        hostname,
        stations: results,
        message: `Registered ${results.length} station(s) successfully`,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.post('/heartbeat', agentAuth, agentLimiter, validate(heartbeatSchema), async (req: Request, res: Response) => {
  try {
    const { agentId, stationId, printers } = req.body;

    // Update station heartbeat timestamp to prevent offline watchdog
    if (stationId) {
      try {
        const printerStatus = printers[0];
        await prisma.station.update({
          where: { id: stationId },
          data: {
            lastHeartbeatAt: new Date(),
            isReady: printerStatus?.status !== 'OFFLINE',
          },
        });
      } catch (error) {
        console.error(`Failed to update station ${stationId}:`, error);
      }
    }

    for (const printerUpdate of printers) {
      try {
        await printerService.updatePrinterStatus(printerUpdate.printerId, {
          isOnline: printerUpdate.status !== 'OFFLINE',
          currentState: printerUpdate.status,
          paperStatus: printerUpdate.paperStatus,
          paperLevel: printerUpdate.paperLevel,
          tonerStatus: printerUpdate.tonerStatus,
          tonerLevel: printerUpdate.tonerLevel,
        });
      } catch (error) {
        console.error(`Failed to update printer ${printerUpdate.printerId}:`, error);
      }
    }

    res.json({
      success: true,
      data: {
        agentId,
        timestamp: new Date().toISOString(),
        printersUpdated: printers.length,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/jobs/poll', agentAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 5;
    const stationId = req.query.stationId as string | undefined;
    const jobs = await jobService.getAuthorizedJobs(limit, stationId);
    res.json({ success: true, data: jobs });
  } catch (error) {
    throw error;
  }
});

router.get('/jobs/:agentId', agentAuth, async (req: Request, res: Response) => {
  try {
    const jobs = await jobService.getPendingJobsForAgent(req.params.agentId);
    res.json({ success: true, data: jobs });
  } catch (error) {
    throw error;
  }
});

router.post('/jobs/:jobId/claim', agentAuth, agentLimiter, async (req: Request, res: Response) => {
  try {
    const { authorizationToken } = req.body;
    const agentId = req.headers['x-agent-id'] as string;
    const job = await jobService.claimJob(req.params.jobId, authorizationToken, agentId, req.ip);
    res.json({ success: true, data: job });
  } catch (error) {
    throw error;
  }
});

router.post('/jobs/:jobId/complete', agentAuth, agentLimiter, async (req: Request, res: Response) => {
  try {
    const { status, pagesPrinted, errorMessage } = req.body;
    const agentId = req.headers['x-agent-id'] as string;
    const job = await jobService.completeJob(req.params.jobId, status, pagesPrinted, errorMessage, agentId, req.ip);
    res.json({ success: true, data: job });
  } catch (error) {
    throw error;
  }
});

router.post('/jobs/:jobId/status', agentAuth, agentLimiter, validate(jobStatusSchema), async (req: Request, res: Response) => {
  try {
    const job = await jobService.updateJobPrintStatus(
      req.params.jobId,
      req.body.status,
      undefined,
      req.body.errorMessage,
      req.ip
    );
    res.json({ success: true, data: job });
  } catch (error) {
    throw error;
  }
});

router.post('/printers/:printerId/status', agentAuth, agentLimiter, validate(printerStatusSchema), async (req: Request, res: Response) => {
  try {
    const printer = await printerService.updatePrinterStatus(req.params.printerId, {
      isOnline: req.body.status !== 'OFFLINE',
      currentState: req.body.status,
      paperStatus: req.body.paperStatus,
      paperLevel: req.body.paperLevel,
      tonerStatus: req.body.tonerStatus,
      tonerLevel: req.body.tonerLevel,
    });
    res.json({ success: true, data: printer });
  } catch (error) {
    throw error;
  }
});

// Agent dashboard endpoints - scoped to the agent's own data

router.get('/dashboard', agentAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers['x-agent-id'] as string;

    // Find all stations registered by this agent
    const stations = await prisma.station.findMany({
      where: { agentId },
      include: {
        printers: true,
        _count: { select: { jobs: true } },
      },
    }) as any[];

    // Get job stats for this agent's stations
    const stationIds = stations.map((s: { id: string }) => s.id);
    const [totalJobs, completedJobs, failedJobs, totalRevenue] = await Promise.all([
      prisma.printJob.count({ where: { stationId: { in: stationIds } } }),
      prisma.printJob.count({ where: { stationId: { in: stationIds }, printStatus: 'COMPLETED' } }),
      prisma.printJob.count({ where: { stationId: { in: stationIds }, printStatus: { in: ['PRINT_FAILED', 'PRINTER_ERROR'] } } }),
      prisma.paymentTransaction.aggregate({
        where: { status: 'SUCCESS', job: { stationId: { in: stationIds } } },
        _sum: { amount: true },
      }),
    ]);

    // Recent jobs for this agent's stations
    const recentJobs = await prisma.printJob.findMany({
      where: { stationId: { in: stationIds } },
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { station: true, printer: true },
    });

    res.json({
      success: true,
      data: {
        agentId,
        stations: stations.map(s => ({
          id: s.id,
          name: s.name,
          hostname: s.hostname,
          platform: s.platform,
          isActive: s.isActive,
          printerCount: s.printers.length,
          jobCount: s._count.printJobs,
          printers: s.printers.map((p: any) => ({
            id: p.id,
            name: p.name,
            isOnline: p.isOnline,
            currentState: p.currentState,
            paperStatus: p.paperStatus,
            paperLevel: p.paperLevel,
            tonerStatus: p.tonerStatus,
            tonerLevel: p.tonerLevel,
          })),
        })),
        stats: {
          totalJobs,
          completedJobs,
          failedJobs,
          totalRevenue: totalRevenue._sum.amount || 0,
          stationCount: stations.length,
          printerCount: stations.reduce((acc, s) => acc + s.printers.length, 0),
        },
        recentJobs,
      },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/stations', agentAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers['x-agent-id'] as string;
    const stations = await prisma.station.findMany({
      where: { agentId },
      include: { printers: true },
    });
    res.json({ success: true, data: stations });
  } catch (error) {
    throw error;
  }
});

router.get('/printers', agentAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers['x-agent-id'] as string;
    const stations = await prisma.station.findMany({ where: { agentId }, select: { id: true } });
    const stationIds = stations.map((s: { id: string }) => s.id);
    const printers = await prisma.printer.findMany({
      where: { stationId: { in: stationIds } },
      include: { station: true },
    });
    res.json({ success: true, data: printers });
  } catch (error) {
    throw error;
  }
});

router.get('/jobs', agentAuth, async (req: Request, res: Response) => {
  try {
    const agentId = req.headers['x-agent-id'] as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const stations = await prisma.station.findMany({ where: { agentId }, select: { id: true } });
    const stationIds = stations.map((s: { id: string }) => s.id);

    const [jobs, total] = await Promise.all([
      prisma.printJob.findMany({
        where: { stationId: { in: stationIds } },
        include: { station: true, printer: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.printJob.count({ where: { stationId: { in: stationIds } } }),
    ]);

    res.json({
      success: true,
      data: jobs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    throw error;
  }
});

router.get('/download/:jobId', agentAuth, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await prisma.printJob.findUnique({
      where: { jobId },
      include: { file: true },
    });

    if (!job || !job.file) {
      res.status(404).json({ success: false, error: 'Job or file not found' });
      return;
    }

    const fileRecord = job.file as any;
    const { getSignedDownloadUrl } = require('../lib/cloudinary');
    const downloadUrl = getSignedDownloadUrl(fileRecord.storedFilename);

    console.log(`Downloading file for job ${jobId} from signed URL`);

    const response = await fetch(downloadUrl, { redirect: 'follow' });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('File download failed:', response.status, errorText);
      res.status(502).json({ success: false, error: 'Failed to fetch file from storage' });
      return;
    }

    const contentType = response.headers.get('content-type') || 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${job.file.originalFilename}"`);

    const body = response.body;
    if (body) {
      const { pipeline } = require('stream/promises');
      const { Readable } = require('stream');

      const nodeStream = new Readable({
        async read() {
          const reader = body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                this.push(null);
                break;
              }
              this.push(Buffer.from(value));
            }
          } catch (err) {
            this.destroy(err);
          }
        }
      });

      await pipeline(nodeStream, res);
    } else {
      res.status(502).json({ success: false, error: 'Empty response from storage' });
    }
  } catch (error) {
    console.error('Download error:', error);
    throw error;
  }
});

// Pre-payment readiness: agent reports station hardware status
const stationReadySchema = z.object({
  stationId: z.string().uuid(),
  isReady: z.boolean(),
  printerStatus: z.object({
    status: z.enum(['IDLE', 'PRINTING', 'PAUSED', 'ERROR', 'OFFLINE']),
    paperStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
    tonerStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
    errorMessage: z.string().optional(),
  }).optional(),
});

router.post('/station-ready', agentAuth, validate(stationReadySchema), async (req: Request, res: Response) => {
  try {
    const { stationId, isReady, printerStatus } = req.body;

    await prisma.station.update({
      where: { id: stationId },
      data: {
        isReady,
        lastHeartbeatAt: new Date(),
      },
    });

    // Update printer status if provided
    if (printerStatus) {
      const printer = await prisma.printer.findFirst({ where: { stationId } });
      if (printer) {
        await prisma.printer.update({
          where: { id: printer.id },
          data: {
            isOnline: printerStatus.status !== 'OFFLINE',
            currentState: printerStatus.status,
            paperStatus: printerStatus.paperStatus || 'UNKNOWN',
            tonerStatus: printerStatus.tonerStatus || 'UNKNOWN',
            lastSeenAt: new Date(),
          },
        });
      }
    }

    res.json({ success: true, data: { stationId, isReady } });
  } catch (error) {
    throw error;
  }
});

// Pre-payment check: customer app queries station readiness before showing payment button
router.get('/station/:stationId/readiness', async (req: Request, res: Response) => {
  try {
    const { stationId } = req.params;

    const station = await prisma.station.findUnique({
      where: { id: stationId },
      include: { printers: true },
    });

    if (!station) {
      res.status(404).json({ success: false, error: 'Station not found' });
      return;
    }

    // Consider station offline if no heartbeat in last 2 minutes
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const isOnline = station.lastHeartbeatAt && station.lastHeartbeatAt > twoMinutesAgo;

    // Check if any printer has a blocking error
    const hasBlockingError = station.printers.some((p: any) =>
      p.currentState === 'ERROR' || p.currentState === 'OFFLINE'
    );

    const hasPaperEmpty = station.printers.some((p: any) =>
      p.paperStatus === 'EMPTY'
    );

    const ready = station.isReady && isOnline && !hasBlockingError && !hasPaperEmpty;

    let blockingReason = '';
    if (!isOnline) blockingReason = 'Station is offline';
    else if (hasPaperEmpty) blockingReason = 'Printer is out of paper';
    else if (hasBlockingError) blockingReason = 'Printer has a hardware error';

    res.json({
      success: true,
      data: {
        ready,
        isOnline,
        hasBlockingError,
        hasPaperEmpty,
        blockingReason,
        printers: station.printers.map((p: any) => ({
          name: p.name,
          status: p.currentState,
          paperStatus: p.paperStatus,
          tonerStatus: p.tonerStatus,
        })),
      },
    });
  } catch (error) {
    throw error;
  }
});

export default router;
