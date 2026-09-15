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

// Watchdog: find jobs stuck in PRINTING for >10 minutes and mark them as failed
export async function cleanupStuckJobs(): Promise<number> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const stuckJobs = await prisma.printJob.findMany({
    where: {
      printStatus: 'PRINTING',
      startedAt: { lt: tenMinutesAgo },
    },
  });

  let fixedCount = 0;
  for (const job of stuckJobs) {
    try {
      await prisma.printJob.update({
        where: { id: job.id },
        data: {
          printStatus: 'PRINTER_ERROR',
          errorMessage: 'Job timed out: stuck in PRINTING for over 10 minutes',
          completedAt: new Date(),
        },
      });
      console.log(`[Watchdog] Fixed stuck job ${job.jobId}`);
      fixedCount++;
    } catch (error) {
      console.error(`[Watchdog] Failed to fix stuck job ${job.jobId}:`, error);
    }
  }

  if (fixedCount > 0) {
    console.log(`[Watchdog] Fixed ${fixedCount} stuck jobs`);
  }
  return fixedCount;
}

// Mark stations as offline if no heartbeat in last 2 minutes
export async function cleanupOfflineStations(): Promise<number> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

  const result = await prisma.station.updateMany({
    where: {
      isReady: true,
      lastHeartbeatAt: { lt: twoMinutesAgo },
    },
    data: {
      isReady: false,
    },
  });

  if (result.count > 0) {
    console.log(`[Watchdog] Marked ${result.count} stations as offline (no heartbeat)`);
  }
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
