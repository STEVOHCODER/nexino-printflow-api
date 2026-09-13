import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation';
import { adminAuth } from '../middleware/auth';
import * as printerService from '../services/printerService';

const router = Router();

const createPrinterSchema = z.object({
  name: z.string().min(1).max(100),
  stationId: z.string().uuid(),
  printerUri: z.string().min(1),
  adapterType: z.enum(['WINDOWS', 'CUPS', 'IPP', 'VIRTUAL']).optional(),
});

const updateStatusSchema = z.object({
  isOnline: z.boolean().optional(),
  currentState: z.enum(['IDLE', 'PRINTING', 'PAUSED', 'ERROR', 'OFFLINE']).optional(),
  paperStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
  paperLevel: z.number().int().min(0).max(100).nullable().optional(),
  tonerStatus: z.enum(['UNKNOWN', 'OK', 'LOW', 'EMPTY']).optional(),
  tonerLevel: z.number().int().min(0).max(100).nullable().optional(),
});

router.post('/', adminAuth, validate(createPrinterSchema), async (req: Request, res: Response) => {
  try {
    const printer = await printerService.createPrinter(req.body);
    res.status(201).json({ success: true, data: printer });
  } catch (error) {
    throw error;
  }
});

router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const stationId = req.query.stationId as string | undefined;

    const result = await printerService.listPrinters(stationId, page, limit);
    res.json({ success: true, data: result.printers, pagination: result.pagination });
  } catch (error) {
    throw error;
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const printer = await printerService.getPrinterById(req.params.id);
    res.json({ success: true, data: printer });
  } catch (error) {
    throw error;
  }
});

router.put('/:id/status', adminAuth, validate(updateStatusSchema), async (req: Request, res: Response) => {
  try {
    const printer = await printerService.updatePrinterStatus(req.params.id, req.body);
    res.json({ success: true, data: printer });
  } catch (error) {
    throw error;
  }
});

router.get('/station/:stationId', async (req: Request, res: Response) => {
  try {
    const printers = await printerService.getPrintersByStation(req.params.stationId);
    res.json({ success: true, data: printers });
  } catch (error) {
    throw error;
  }
});

router.delete('/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    await printerService.deletePrinter(req.params.id);
    res.json({ success: true, message: 'Printer deleted successfully' });
  } catch (error) {
    throw error;
  }
});

export default router;
