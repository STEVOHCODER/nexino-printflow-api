import { config } from '../config';
import { generateChecksum } from '../utils/idGenerator';
import { BadRequestError, NotFoundError } from '../middleware/errorHandler';
import prisma from '../config/database';
import { uploadPDF, deletePDF } from '../lib/cloudinary';

const ALLOWED_MIMES = ['application/pdf'];

export async function validateAndProcessBuffer(buffer: Buffer, originalFilename: string): Promise<{
  pageCount: number;
  fileSize: number;
  checksum: string;
  mimeType: string;
}> {
  const checksum = generateChecksum(buffer);

  if (buffer.length === 0) {
    throw new BadRequestError('File is empty');
  }

  if (buffer.length > 50 * 1024 * 1024) {
    throw new BadRequestError('File exceeds maximum size of 50MB');
  }

  const header = buffer.toString('latin1', 0, 5);
  if (header !== '%PDF-') {
    throw new BadRequestError('Invalid PDF file');
  }

  const pageCount = estimatePageCount(buffer);

  if (pageCount > 500) {
    throw new BadRequestError('PDF exceeds maximum page limit of 500 pages');
  }

  return {
    pageCount,
    fileSize: buffer.length,
    checksum,
    mimeType: 'application/pdf',
  };
}

function estimatePageCount(buffer: Buffer): number {
  const content = buffer.toString('latin1');
  const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
  return pageMatches ? Math.max(pageMatches.length, 1) : 1;
}

export async function uploadToCloudinary(buffer: Buffer, originalFilename: string): Promise<string> {
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const publicId = `nexino-${uniqueSuffix}`;

  const result = await uploadPDF(buffer, publicId);
  return result.public_id;
}

export async function createUploadedFile(
  stationId: string,
  originalFilename: string,
  storedFilename: string,
  mimeType: string,
  fileSize: number,
  pageCount: number,
  checksum: string
) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + config.retentionHours);

  return prisma.uploadedFile.create({
    data: {
      originalFilename,
      storedFilename,
      mimeType,
      fileSize,
      pageCount,
      checksum,
      stationId,
      expiresAt,
    },
  });
}

export async function getFileById(fileId: string) {
  const file = await prisma.uploadedFile.findUnique({ where: { id: fileId } });
  if (!file) {
    throw new NotFoundError('File', fileId);
  }
  return file;
}

export async function getDownloadUrl(storedFilename: string): Promise<string> {
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/raw/upload/${storedFilename}`;
}

export async function deleteFile(storedFilename: string): Promise<void> {
  try {
    await deletePDF(storedFilename);
  } catch {
    // File may not exist in Cloudinary, ignore
  }
}

export async function cleanupExpiredFiles(): Promise<number> {
  const expiredFiles = await prisma.uploadedFile.findMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  let deletedCount = 0;
  for (const file of expiredFiles) {
    await deleteFile(file.storedFilename);
    await prisma.uploadedFile.delete({ where: { id: file.id } });
    deletedCount++;
  }

  return deletedCount;
}
