import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validation';
import { adminAuth } from '../middleware/auth';
import * as stationService from '../services/stationService';

const router = Router();

const createStationSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().min(1).max(200),
  isActive: z.boolean().optional(),
});

const updateStationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  location: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

router.post('/', adminAuth, validate(createStationSchema), async (req: Request, res: Response) => {
  try {
    const result = await stationService.createStation(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    throw error;
  }
});

router.get('/', adminAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const includeInactive = req.query.includeInactive === 'true';

    const result = await stationService.listStations(page, limit, includeInactive);
    res.json({ success: true, data: result.stations, pagination: result.pagination });
  } catch (error) {
    throw error;
  }
});

router.get('/code/:code', async (req: Request, res: Response) => {
  try {
    const station = await stationService.getStationByCode(req.params.code);
    res.json({ success: true, data: station });
  } catch (error) {
    throw error;
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const station = await stationService.getStationById(req.params.id);
    res.json({ success: true, data: station });
  } catch (error) {
    throw error;
  }
});

router.put('/:id', adminAuth, validate(updateStationSchema), async (req: Request, res: Response) => {
  try {
    const station = await stationService.updateStation(req.params.id, req.body);
    res.json({ success: true, data: station });
  } catch (error) {
    throw error;
  }
});

router.delete('/:id', adminAuth, async (req: Request, res: Response) => {
  try {
    await stationService.deleteStation(req.params.id);
    res.json({ success: true, message: 'Station deleted successfully' });
  } catch (error) {
    throw error;
  }
});

router.get('/:id/qr', async (req: Request, res: Response) => {
  try {
    const qrDataUrl = await stationService.generateStationQR(req.params.id);
    res.json({ success: true, data: { qrCode: qrDataUrl } });
  } catch (error) {
    throw error;
  }
});

router.get('/:id/stats', adminAuth, async (req: Request, res: Response) => {
  try {
    const stats = await stationService.getStationStats(req.params.id);
    res.json({ success: true, data: stats });
  } catch (error) {
    throw error;
  }
});

export default router;
