import { Router } from 'express';
import { tplService } from '../services/tpl.service';

const router = Router();

// POST /api/v1/tpl/onboard
router.post('/onboard', async (req, res) => {
  try {
    const data = await tplService.onboard(req.body);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tpl/queue
router.get('/queue', async (req, res) => {
  try {
    const status = req.query.status as string || 'pending';
    const data = await tplService.getQueue(status);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/v1/tpl/:id
router.get('/:id', async (req, res) => {
  try {
    const data = await tplService.getPartner(req.params.id);
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/v1/tpl/approve/:id
router.post('/approve/:id', async (req, res) => {
  try {
    const data = await tplService.approve(req.params.id, req.body.email || '');
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/v1/tpl/:id
router.patch('/:id', async (req, res) => {
  try {
    const data = await tplService.updateApplication(req.params.id, req.body);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
