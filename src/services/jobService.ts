import { ColorMode, PaperSize, PrintJobStatus, PaymentStatus, AuthorizationStatus, PaymentProvider } from '../types';
import { generateJobId, generateAuthorizationToken } from '../utils/idGenerator';
import { calculatePrice } from '../utils/pricing';
import { BadRequestError, NotFoundError, ConflictError } from '../middleware/errorHandler';
import prisma from '../config/database';
import { processPayment } from './paymentService';
import { auditService } from './auditService';
import { config } from '../config';
import { getDownloadUrl } from './fileService';

export async function createJob(params: {
  fileId: string;
  stationId: string;
  pageRange?: string;
  copies?: number;
  colorMode?: ColorMode;
  paperSize?: PaperSize;
  duplex?: boolean;
  idempotencyKey?: string;
  ipAddress?: string;
}) {
  const { fileId, stationId, pageRange, copies = 1, colorMode = ColorMode.BW, paperSize = PaperSize.A4, duplex = false, idempotencyKey, ipAddress } = params;

  if (idempotencyKey) {
    const existingJob = await prisma.printJob.findUnique({
      where: { idempotencyKey },
    });
    if (existingJob) {
      return existingJob;
    }
  }

  const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
  if (!file) {
    throw new NotFoundError('File', fileId);
  }

  if (file.expiresAt < new Date()) {
    throw new BadRequestError('File has expired. Please upload again');
  }

  const station = await prisma.station.findUnique({ where: { id: stationId } });
  if (!station) {
    throw new NotFoundError('Station', stationId);
  }
  if (!station.isActive) {
    throw new BadRequestError('Station is not active');
  }

  let pageCount = file.pageCount;
  if (pageRange) {
    const parsed = parsePageRange(pageRange, file.pageCount);
    pageCount = parsed.length;
  }

  const pricing = calculatePrice({
    pageCount,
    copies,
    colorMode,
    paperSize,
    duplex,
  });

  const jobId = generateJobId();
  const authorizationToken = generateAuthorizationToken();

  const job = await prisma.printJob.create({
    data: {
      jobId,
      stationId,
      fileId,
      originalFilename: file.originalFilename,
      pageCount,
      pageRange: pageRange || null,
      copies,
      colorMode,
      paperSize,
      duplex,
      price: pricing.totalPrice,
      currency: pricing.currency,
      paymentStatus: PaymentStatus.PENDING,
      authorizationStatus: AuthorizationStatus.PENDING,
      printStatus: PrintJobStatus.PRICE_CALCULATED,
      authorizationToken,
      idempotencyKey: idempotencyKey || generateJobId(),
    },
    include: {
      station: true,
      file: true,
    },
  });

  await auditService.log({
    action: 'JOB_CREATED',
    entityType: 'PrintJob',
    entityId: job.id,
    details: { jobId: job.jobId, price: job.price, colorMode, paperSize },
    ipAddress,
  });

  return job;
}

export async function getJobByJobId(jobId: string) {
  const job = await prisma.printJob.findUnique({
    where: { jobId },
    include: {
      station: true,
      printer: true,
      file: true,
      payments: true,
    },
  });
  if (!job) {
    throw new NotFoundError('Job', jobId);
  }

  let downloadUrl: string | null = null;
  if (job.file) {
    downloadUrl = await getDownloadUrl(job.file.storedFilename);
  }

  return {
    ...job,
    downloadUrl,
  };
}

export async function getJobById(id: string) {
  const job = await prisma.printJob.findUnique({
    where: { id },
    include: {
      station: true,
      printer: true,
      file: true,
      payments: true,
    },
  });
  if (!job) {
    throw new NotFoundError('Job', id);
  }
  return job;
}

export async function authorizeJob(jobId: string, authorizationToken: string, ipAddress?: string) {
  const job = await prisma.printJob.findUnique({ where: { jobId } });
  if (!job) {
    throw new NotFoundError('Job', jobId);
  }

  if (job.authorizationToken !== authorizationToken) {
    throw new BadRequestError('Invalid authorization token');
  }

  if (job.authorizationStatus === AuthorizationStatus.AUTHORIZED) {
    throw new ConflictError('Job already authorized');
  }

  if (job.paymentStatus !== PaymentStatus.SUCCESS) {
    throw new BadRequestError('Payment must be completed before authorization');
  }

  const updatedJob = await prisma.printJob.update({
    where: { id: job.id },
    data: {
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
      printStatus: PrintJobStatus.AUTHORIZED,
    },
  });

  await auditService.log({
    action: 'JOB_AUTHORIZED',
    entityType: 'PrintJob',
    entityId: job.id,
    details: { jobId: job.jobId },
    ipAddress,
  });

  return updatedJob;
}

export async function processJobPayment(jobId: string, provider: string, reference?: string, metadata?: Record<string, unknown>, ipAddress?: string) {
  const job = await prisma.printJob.findUnique({ where: { jobId } });
  if (!job) {
    throw new NotFoundError('Job', jobId);
  }

  if (job.paymentStatus === PaymentStatus.SUCCESS) {
    throw new ConflictError('Payment already completed');
  }

  if (job.paymentStatus === PaymentStatus.PROCESSING) {
    throw new ConflictError('Payment already in progress');
  }

  await prisma.printJob.update({
    where: { id: job.id },
    data: { paymentStatus: PaymentStatus.PROCESSING, printStatus: PrintJobStatus.PAYMENT_PROCESSING },
  });

  const paymentRef = reference || `PAY-${jobId}-${Date.now()}`;

  try {
    const result = await processPayment(
      job.id,
      job.price,
      job.currency,
      provider as PaymentProvider,
      paymentRef,
      metadata
    );

    if (result.success) {
      await prisma.printJob.update({
        where: { id: job.id },
        data: {
          paymentStatus: PaymentStatus.SUCCESS,
          paymentRef: result.reference,
          authorizationStatus: AuthorizationStatus.AUTHORIZED,
          printStatus: PrintJobStatus.AUTHORIZED,
        },
      });

      await auditService.log({
        action: 'PAYMENT_SUCCESS',
        entityType: 'PrintJob',
        entityId: job.id,
        details: { jobId: job.jobId, amount: job.price, provider, reference: result.reference },
        ipAddress,
      });

      await auditService.log({
        action: 'JOB_AUTHORIZED',
        entityType: 'PrintJob',
        entityId: job.id,
        details: { jobId: job.jobId },
        ipAddress,
      });

      return { success: true, job: await getJobById(job.id) };
    } else {
      await prisma.printJob.update({
        where: { id: job.id },
        data: {
          paymentStatus: PaymentStatus.FAILED,
          printStatus: PrintJobStatus.CREATED,
          errorMessage: result.error,
        },
      });

      await auditService.log({
        action: 'PAYMENT_FAILED',
        entityType: 'PrintJob',
        entityId: job.id,
        details: { jobId: job.jobId, error: result.error },
        ipAddress,
      });

      return { success: false, error: result.error };
    }
  } catch (error) {
    await prisma.printJob.update({
      where: { id: job.id },
      data: {
        paymentStatus: PaymentStatus.FAILED,
        printStatus: PrintJobStatus.CREATED,
        errorMessage: error instanceof Error ? error.message : 'Payment processing failed',
      },
    });
    throw error;
  }
}

export async function cancelJob(jobId: string, ipAddress?: string) {
  const job = await prisma.printJob.findUnique({ where: { jobId } });
  if (!job) {
    throw new NotFoundError('Job', jobId);
  }

  const terminalStatuses = ['COMPLETED', 'CANCELLED', 'REFUNDED'];

  if (terminalStatuses.includes(job.printStatus as string)) {
    throw new ConflictError(`Cannot cancel job in ${job.printStatus} status`);
  }

  const updatedJob = await prisma.printJob.update({
    where: { id: job.id },
    data: {
      printStatus: PrintJobStatus.CANCELLED,
      errorMessage: 'Cancelled by user',
    },
  });

  await auditService.log({
    action: 'JOB_CANCELLED',
    entityType: 'PrintJob',
    entityId: job.id,
    details: { jobId: job.jobId },
    ipAddress,
  });

  return updatedJob;
}

export async function updateJobPrintStatus(
  jobId: string,
  status: PrintJobStatus,
  printerId?: string,
  errorMessage?: string,
  ipAddress?: string
) {
  const job = await prisma.printJob.findUnique({ where: { jobId } });
  if (!job) {
    throw new NotFoundError('Job', jobId);
  }

  const updateData: Record<string, unknown> = {
    printStatus: status,
  };

  if (printerId) {
    updateData.printerId = printerId;
  }

  if (errorMessage) {
    updateData.errorMessage = errorMessage;
  }

  if (status === PrintJobStatus.PRINTING) {
    updateData.startedAt = new Date();
  }

  if (status === PrintJobStatus.COMPLETED || status === PrintJobStatus.PRINT_FAILED) {
    updateData.completedAt = new Date();
  }

  const updatedJob = await prisma.printJob.update({
    where: { id: job.id },
    data: updateData,
  });

  await auditService.log({
    action: `JOB_STATUS_${status}`,
    entityType: 'PrintJob',
    entityId: job.id,
    details: { jobId: job.jobId, status, printerId, errorMessage },
    ipAddress,
  });

  return updatedJob;
}

export async function listJobsForStation(stationId: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  const [jobs, total] = await Promise.all([
    prisma.printJob.findMany({
      where: { stationId },
      include: { printer: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.printJob.count({ where: { stationId } }),
  ]);

  return {
    jobs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getPendingJobsForAgent(agentId: string) {
  const jobs = await prisma.printJob.findMany({
    where: {
      printStatus: { in: [PrintJobStatus.AUTHORIZED, PrintJobStatus.QUEUED] },
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
      paymentStatus: PaymentStatus.SUCCESS,
    },
    include: {
      station: true,
      file: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 10,
  });

  return jobs;
}

export async function getAuthorizedJobs(limit: number = 5, stationId?: string) {
    const where: any = {
      printStatus: PrintJobStatus.AUTHORIZED,
      authorizationStatus: AuthorizationStatus.AUTHORIZED,
      paymentStatus: PaymentStatus.SUCCESS,
    };
    if (stationId) {
      where.stationId = stationId;
    }

    const jobs = await prisma.printJob.findMany({
      where,
      include: {
        station: true,
        file: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    const jobsWithUrls = await Promise.all(
      jobs.map(async (job) => {
        let downloadUrl: string | null = null;
        if (job.file) {
          downloadUrl = await getDownloadUrl(job.file.storedFilename);
        }
        return { ...job, downloadUrl };
      })
    );

    return jobsWithUrls;
  }

export async function claimJob(jobId: string, authorizationToken: string, agentId: string, ipAddress?: string) {
    // Atomic claim: use a transaction with CAS (compare-and-swap) on printStatus
    // This prevents two agents from claiming the same job
    const job = await prisma.printJob.findUnique({ where: { jobId } });
    if (!job) {
      throw new NotFoundError('Job', jobId);
    }

    if (job.authorizationToken !== authorizationToken) {
      throw new BadRequestError('Invalid authorization token');
    }

    // Atomic update: only succeeds if status is still AUTHORIZED
    const [updatedJob] = await prisma.$transaction([
      prisma.printJob.updateMany({
        where: {
          id: job.id,
          printStatus: PrintJobStatus.AUTHORIZED,  // CAS condition
        },
        data: {
          printStatus: PrintJobStatus.QUEUED,
          startedAt: new Date(),
        },
      }),
      prisma.printJob.findUnique({ where: { id: job.id } }),
    ]);

    // Re-fetch to get the updated state
    const result = await prisma.printJob.findUnique({ where: { id: job.id } });
    if (!result || result.printStatus !== PrintJobStatus.QUEUED) {
      throw new ConflictError('Job was already claimed by another agent');
    }

    // Assign printer
    const printer = await prisma.printer.findFirst({
      where: { stationId: job.stationId, isOnline: true },
    });

    const finalJob = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        printerId: printer?.id || null,
      },
    });

    await auditService.log({
      action: 'JOB_CLAIMED',
      entityType: 'PrintJob',
      entityId: job.id,
    details: { jobId: job.jobId, agentId, printerId: printer?.id },
    ipAddress,
  });

  return updatedJob;
}

export async function completeJob(
    jobId: string,
    status: 'SUCCESS' | 'COMPLETED' | 'FAILED' | 'PRINT_FAILED',
    pagesPrinted?: number,
    errorMessage?: string,
    agentId?: string,
    ipAddress?: string
  ) {
    const job = await prisma.printJob.findUnique({ where: { jobId } });
    if (!job) {
      throw new NotFoundError('Job', jobId);
    }
  
    if (status === 'SUCCESS' || status === 'COMPLETED') {
    const updatedJob = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        printStatus: PrintJobStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    await auditService.log({
      action: 'JOB_COMPLETED',
      entityType: 'PrintJob',
      entityId: job.id,
      details: { jobId: job.jobId, agentId, pagesPrinted },
      ipAddress,
    });

    return updatedJob;
  } else {
    const updatedJob = await prisma.printJob.update({
      where: { id: job.id },
      data: {
        printStatus: PrintJobStatus.PRINT_FAILED,
        errorMessage: errorMessage || 'Print failed',
        completedAt: new Date(),
      },
    });

    await auditService.log({
      action: 'JOB_FAILED',
      entityType: 'PrintJob',
      entityId: job.id,
      details: { jobId: job.jobId, agentId, error: errorMessage },
      ipAddress,
    });

    return updatedJob;
  }
}

function parsePageRange(range: string, maxPages: number): number[] {
  const pages = new Set<number>();
  const parts = range.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end) || start < 1 || end > maxPages || start > end) {
        throw new BadRequestError(`Invalid page range: ${trimmed}`);
      }
      for (let i = start; i <= end; i++) {
        pages.add(i);
      }
    } else {
      const page = parseInt(trimmed, 10);
      if (isNaN(page) || page < 1 || page > maxPages) {
        throw new BadRequestError(`Invalid page number: ${trimmed}`);
      }
      pages.add(page);
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}
