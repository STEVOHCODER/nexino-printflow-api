import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation';
import { stationAuth, optionalAuth, validateStationId } from '../middleware/auth';
import { uploadLimiter, paymentLimiter } from '../middleware/rateLimit';
import * as jobService from '../services/jobService';
import { validateAndProcessBuffer, uploadToCloudinary, createUploadedFile, getDownloadUrl } from '../services/fileService';
import { calculatePrice } from '../utils/pricing';
import prisma from '../config/database';

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

const router = Router();

const createJobSchema = z.object({
  fileId: z.string().uuid(),
  stationId: z.string().uuid(),
  pageRange: z.string().optional(),
  copies: z.number().int().min(1).max(100).optional(),
  colorMode: z.enum(['BW', 'COLOR']).optional(),
  paperSize: z.enum(['A3', 'A4', 'A5', 'LETTER']).optional(),
  duplex: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
});

const paymentSchema = z.object({
  provider: z.enum(['MOCK', 'MOBILE_MONEY', 'CARD']),
  reference: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const calculatePriceSchema = z.object({
  pageCount: z.number().int().min(1).max(500),
  copies: z.number().int().min(1).max(100).optional().default(1),
  colorMode: z.enum(['BW', 'COLOR']).optional().default('BW'),
  paperSize: z.enum(['A3', 'A4', 'A5', 'LETTER']).optional().default('A4'),
  duplex: z.boolean().optional().default(false),
});

router.post('/upload', uploadLimiter, asyncHandler(async (req: Request, res: Response) => {
    if (!req.body || !req.body.file) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    const stationId = req.body.stationId;
    if (!stationId) {
      res.status(400).json({ success: false, error: 'Station ID required' });
      return;
    }

    const station = await prisma.station.findUnique({ where: { id: stationId } });
    if (!station || !station.isActive) {
      res.status(404).json({ success: false, error: 'Station not found or inactive' });
      return;
    }

    const fileBuffer = Buffer.from(req.body.file, 'base64');
    const originalFilename = req.body.filename || 'upload.pdf';

    const validation = await validateAndProcessBuffer(fileBuffer, originalFilename);

    const storedFilename = await uploadToCloudinary(fileBuffer, originalFilename);

    const uploadedFile = await createUploadedFile(
      stationId,
      originalFilename,
      storedFilename,
      validation.mimeType,
      validation.fileSize,
      validation.pageCount,
      validation.checksum
    );

    res.status(201).json({
      success: true,
      data: {
        fileId: uploadedFile.id,
        originalFilename: uploadedFile.originalFilename,
        pageCount: uploadedFile.pageCount,
        fileSize: uploadedFile.fileSize,
        storedFilename: uploadedFile.storedFilename,
      },
    });
}));

router.post('/download-url', asyncHandler(async (req: Request, res: Response) => {
    const { storedFilename } = req.body;
    if (!storedFilename) {
      res.status(400).json({ success: false, error: 'storedFilename required' });
      return;
    }
    const url = await getDownloadUrl(storedFilename);
    res.json({ success: true, data: { url } });
}));

router.post('/calculate-price', optionalAuth, validate(calculatePriceSchema), asyncHandler(async (req: Request, res: Response) => {
    const pricing = calculatePrice(req.body);
    res.json({ success: true, data: pricing });
}));

router.post('/', validate(createJobSchema), asyncHandler(async (req: Request, res: Response) => {
    const { stationId } = req.body;
    const station = await prisma.station.findUnique({ where: { id: stationId } });
    if (!station || !station.isActive) {
      res.status(404).json({ success: false, error: 'Station not found or inactive' });
      return;
    }
    const job = await jobService.createJob({
      ...req.body,
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, data: job });
}));

router.get('/:jobId', asyncHandler(async (req: Request, res: Response) => {
    const job = await jobService.getJobByJobId(req.params.jobId);
    res.json({ success: true, data: job });
}));

router.post('/:jobId/pay', paymentLimiter, validate(paymentSchema), asyncHandler(async (req: Request, res: Response) => {
    const result = await jobService.processJobPayment(
      req.params.jobId,
      req.body.provider,
      req.body.reference,
      req.body.metadata,
      req.ip
    );

    if (result.success) {
      res.json({ success: true, data: result.job });
    } else {
      res.status(402).json({ success: false, error: result.error });
    }
}));

router.post('/:jobId/cancel', asyncHandler(async (req: Request, res: Response) => {
    const job = await jobService.cancelJob(req.params.jobId, req.ip);
    res.json({ success: true, data: job });
}));

router.get('/station/:stationId', stationAuth, asyncHandler(async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await jobService.listJobsForStation(req.params.stationId, page, limit);
    res.json({ success: true, data: result.jobs, pagination: result.pagination });
}));

export default router;
