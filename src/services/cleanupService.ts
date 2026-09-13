import prisma from '../config/database';
import { deleteFile } from './fileService';
import { config } from '../config';

export async function cleanupExpiredFiles(): Promise<number> {
  const expiredFiles = await prisma.uploadedFile.findMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  let deletedCount = 0;
  for (const file of expiredFiles) {
    try {
      await deleteFile(file.storedFilename);
      await prisma.uploadedFile.delete({ where: { id: file.id } });
      deletedCount++;
    } catch (error) {
      console.error(`[Cleanup] Failed to delete file ${file.id}:`, error);
    }
  }

  console.log(`[Cleanup] Deleted ${deletedCount} expired files`);
  return deletedCount;
}

export async function cleanupOldAuditLogs(): Promise<number> {
  const retentionDays = 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  console.log(`[Cleanup] Deleted ${result.count} old audit logs`);
  return result.count;
}

export async function getStorageStats() {
  const fileCount = await prisma.uploadedFile.count();
  const totalSize = await prisma.uploadedFile.aggregate({
    _sum: { fileSize: true },
  });

  return {
    fileCount,
    totalSizeBytes: totalSize._sum.fileSize || 0,
    totalSizeMb: Math.round((totalSize._sum.fileSize || 0) / (1024 * 1024)),
    retentionHours: config.retentionHours,
  };
}
