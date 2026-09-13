import prisma from '../config/database';
import { Prisma } from '@prisma/client';

export interface AuditLogParams {
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

class AuditService {
  async log(params: AuditLogParams): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          details: params.details ? JSON.parse(JSON.stringify(params.details)) : undefined,
          ipAddress: params.ipAddress || undefined,
        },
      });
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }
  }

  async getLogs(params: {
    entityType?: string;
    entityId?: string;
    action?: string;
    page?: number;
    limit?: number;
  }) {
    const { entityType, entityId, action, page = 1, limit = 50 } = params;
    const skip = (page - 1) * limit;

    const where: Record<string, string> = {};
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (action) where.action = action;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getRecentLogs(limit = 100) {
    return prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const auditService = new AuditService();
