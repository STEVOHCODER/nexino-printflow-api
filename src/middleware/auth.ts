import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import prisma from '../config/database';

export interface AuthPayload {
  userId?: string;
  username?: string;
  role?: string;
  stationId?: string;
  agentId?: string;
  type: 'admin' | 'station' | 'agent';
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
    if (decoded.type !== 'admin') {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }
    req.auth = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function stationAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Station authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
    if (decoded.type !== 'station') {
      res.status(403).json({ success: false, error: 'Station access required' });
      return;
    }
    req.auth = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired station token' });
  }
}

export function agentAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Agent authentication required' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    if (token !== config.agentSecret) {
      res.status(403).json({ success: false, error: 'Invalid agent secret' });
      return;
    }
    req.auth = { type: 'agent', agentId: req.headers['x-agent-id'] as string };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Agent authentication failed' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
      req.auth = decoded;
    } catch {
      // Token invalid, continue without auth
    }
  }
  next();
}

export function generateAdminToken(payload: Omit<AuthPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'admin' }, config.jwtSecret, { expiresIn: '24h' });
}

export function generateStationToken(stationId: string, stationCode: string): string {
  return jwt.sign(
    { stationId, stationCode, type: 'station' },
    config.jwtSecret,
    { expiresIn: '365d' }
  );
}

export async function validateStationId(req: Request, res: Response, next: NextFunction): Promise<void> {
  const stationId = req.body?.stationId || req.params?.stationId || req.query?.stationId;
  if (!stationId) {
    res.status(400).json({ success: false, error: 'Station ID required' });
    return;
  }
  try {
    const station = await prisma.station.findUnique({ where: { id: stationId as string } });
    if (!station || !station.isActive) {
      res.status(404).json({ success: false, error: 'Station not found or inactive' });
      return;
    }
    req.auth = { type: 'station', stationId: station.id };
    next();
  } catch {
    res.status(500).json({ success: false, error: 'Station validation failed' });
  }
}
