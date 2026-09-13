import fs from 'fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
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

  let numPages: number;
  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdfDoc = await loadingTask.promise;
    numPages = pdfDoc.numPages;
  } catch {
    throw new BadRequestError('Invalid or corrupted PDF file');
  }

  if (numPages === 0) {
    throw new BadRequestError('PDF contains no pages');
  }

  if (numPages > 500) {
    throw new BadRequestError('PDF exceeds maximum page limit of 500 pages');
  }

  return {
    pageCount: numPages,
    fileSize: buffer.length,
    checksum,
    mimeType: 'application/pdf',
  };
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
