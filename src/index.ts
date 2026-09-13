import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { generalLimiter } from './middleware/rateLimit';
import { errorHandler } from './middleware/errorHandler';
import prisma from './config/database';

import stationsRouter from './routes/stations';
import printersRouter from './routes/printers';
import jobsRouter from './routes/jobs';
import agentRouter from './routes/agent';
import adminRouter from './routes/admin';
import { cleanupExpiredFiles, cleanupOldAuditLogs } from './services/cleanupService';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: config.corsOrigin === '*' ? '*' : config.corsOrigin.split(','),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Agent-ID'],
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(generalLimiter);

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    },
  });
});

app.use('/api/stations', stationsRouter);
app.use('/api/printers', printersRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/agent', agentRouter);
app.use('/api/admin', adminRouter);

app.get('/api/cron/cleanup', async (_req, res) => {
  try {
    await cleanupExpiredFiles();
    await cleanupOldAuditLogs();
    res.json({ success: true, message: 'Cleanup completed' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Cleanup failed' });
  }
});

app.use((_req, res, _next) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

app.use(errorHandler);

const isVercel = process.env.VERCEL === '1';

if (!isVercel) {
  const server = app.listen(config.port, config.host, async () => {
    console.log(`[Server] Nexino PrintFlow Backend running on http://${config.host}:${config.port}`);
    console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);

    try {
      await prisma.$connect();
      console.log('[Database] Connected to MongoDB');
    } catch (error) {
      console.error('[Database] Connection failed:', error);
    }
  });

  const gracefulShutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);
    server.close(async () => {
      console.log('[Server] HTTP server closed');
      await prisma.$disconnect();
      console.log('[Database] Disconnected');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error.message);
});

export default app;
