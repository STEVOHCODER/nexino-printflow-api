import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
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
  fileId: z.string(),
  stationId: z.string(),
  pageRange: z.string().optional(),
  copies: z.number().int().min(1).max(100).optional(),
  colorMode: z.enum(['BW', 'COLOR', 'MIXED']).optional(),
  paperSize: z.enum(['A3', 'A4', 'A5', 'LETTER']).optional(),
  duplex: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
  pageCount: z.number().int().min(1).max(500).optional(),
  colorPages: z.array(z.number()).optional(),
});

const paymentSchema = z.object({
  provider: z.enum(['MOCK', 'MOBILE_MONEY', 'CARD']),
  reference: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const calculatePriceSchema = z.object({
  stationId: z.string().optional(),
  pageCount: z.number().int().min(1).max(500),
  copies: z.number().int().min(1).max(100).optional().default(1),
  colorMode: z.enum(['BW', 'COLOR', 'MIXED']).optional().default('BW'),
  paperSize: z.enum(['A3', 'A4', 'A5', 'LETTER']).optional().default('A4'),
  duplex: z.boolean().optional().default(false),
  colorPages: z.array(z.number()).optional(),
  coverColor: z.boolean().optional(),
});

function parseMultipart(buffer: Buffer, boundary: string) {
  const parts: { name: string; filename?: string; contentType?: string; data: Buffer }[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(boundaryBuffer) + boundaryBuffer.length + 2;

  while (true) {
    const end = buffer.indexOf(boundaryBuffer, start);
    if (end === -1) break;

    const partData = buffer.subarray(start, end - 2);
    const headerEnd = partData.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = end + boundaryBuffer.length + 2; continue; }

    const headers = partData.subarray(0, headerEnd).toString();
    const body = partData.subarray(headerEnd + 4);

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);
    const contentTypeMatch = headers.match(/Content-Type:\s*(.+)/i);

    parts.push({
      name: nameMatch?.[1] || '',
      filename: filenameMatch?.[1],
      contentType: contentTypeMatch?.[1]?.trim(),
      data: body,
    });

    start = end + boundaryBuffer.length + 2;
  }
  return parts;
}

router.post('/upload', uploadLimiter, asyncHandler(async (req: Request, res: Response) => {
    const contentType = req.headers['content-type'] || '';
    let fileBuffer: Buffer;
    let originalFilename = 'upload.pdf';
    let stationId = '';

    if (contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) {
        res.status(400).json({ success: false, error: 'Invalid multipart data' });
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBuffer = Buffer.concat(chunks);

      const parts = parseMultipart(rawBuffer, boundaryMatch[1]);
      for (const part of parts) {
        if (part.filename) {
          fileBuffer = part.data;
          originalFilename = part.filename;
        } else if (part.name === 'stationId') {
          stationId = part.data.toString().trim();
        }
      }
    } else {
      if (!req.body || !req.body.file) {
        res.status(400).json({ success: false, error: 'No file provided' });
        return;
      }
      fileBuffer = Buffer.from(req.body.file, 'base64');
      originalFilename = req.body.filename || 'upload.pdf';
      stationId = req.body.stationId;
    }

    if (!fileBuffer!) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    if (!stationId) {
      res.status(400).json({ success: false, error: 'Station ID required' });
      return;
    }

    const station = await prisma.station.findUnique({ where: { id: stationId } });
    if (!station || !station.isActive) {
      res.status(404).json({ success: false, error: 'Station not found or inactive' });
      return;
    }

    const validation = await validateAndProcessBuffer(fileBuffer, originalFilename);
    const { publicId, secureUrl } = await uploadToCloudinary(fileBuffer, originalFilename);

    const uploadedFile = await createUploadedFile(
      stationId,
      originalFilename,
      publicId,
      validation.mimeType,
      validation.fileSize,
      validation.pageCount,
      validation.checksum,
      secureUrl
    );

    res.status(201).json({
      success: true,
      data: {
        fileId: uploadedFile.id,
        originalFilename: uploadedFile.originalFilename,
        storedFilename: uploadedFile.storedFilename,
        fileSize: uploadedFile.fileSize,
        pageCount: uploadedFile.pageCount,
        mimeType: uploadedFile.mimeType,
      },
    });
  })
);

router.post('/calculate-price', asyncHandler(async (req: Request, res: Response) => {
    const data = calculatePriceSchema.parse(req.body);

    let stationPricing = null;
    if (data.stationId) {
      const pricingConfig = await prisma.systemConfig.findUnique({ where: { key: `pricing_${data.stationId}` } });
      if (pricingConfig) {
        stationPricing = JSON.parse(pricingConfig.value);
      }
    }

    const colorPages = data.colorMode === 'MIXED' ? (data.colorPages || []) : undefined;

    const price = calculatePrice({
      pageCount: data.pageCount,
      copies: data.copies || 1,
      colorMode: data.colorMode || 'BW',
      paperSize: data.paperSize || 'A4',
      duplex: data.duplex || false,
      colorPages,
      coverColor: data.coverColor,
      stationPricing,
    });
    res.json({ success: true, data: price });
  })
);

router.post('/', asyncHandler(async (req: Request, res: Response) => {
    const data = createJobSchema.parse(req.body);
    const job = await jobService.createJob({
      stationId: data.stationId,
      fileId: data.fileId,
      pageCount: data.pageCount,
      copies: data.copies || 1,
      colorMode: (data.colorMode || 'BW') as any,
      paperSize: (data.paperSize || 'A4') as any,
      duplex: data.duplex || false,
      pageRange: data.pageRange,
      colorPages: data.colorPages,
      idempotencyKey: data.idempotencyKey || `job-${Date.now()}`,
    });
    res.status(201).json({ success: true, data: job });
  })
);

router.post('/:jobId/pay', paymentLimiter, asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const data = paymentSchema.parse(req.body);
    const result = await jobService.processJobPayment(jobId, data.provider, data.reference, data.metadata);
    res.json({ success: true, data: result });
  })
);

router.get('/:jobId', asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = await jobService.getJobById(jobId);
    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }
    const downloadUrl = job.file?.storedFilename ? await getDownloadUrl(job.file.storedFilename, (job.file as any).downloadUrl) : null;
    res.json({
      success: true,
      data: {
        ...job,
        downloadUrl,
        job: undefined,
        file: job.file ? { ...job.file, downloadUrl } : undefined,
      },
    });
  })
);

router.post('/:jobId/cancel', asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const job = await jobService.cancelJob(jobId);
    res.json({ success: true, data: job });
  })
);

export default router;
