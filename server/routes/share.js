const express = require('express');
const router = express.Router();
const { jwtAuth } = require('../middleware/jwtAuth');
const { generateToken } = require('../lib/token');
const db = require('../lib/db');

router.post('/:id/share', jwtAuth, (req, res) => {
  const { recipientEmail, recipientName } = req.body;
  const videoId = req.params.id;

  // Build BASE_URL from request or env var
  const BASE_URL = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

  if (!recipientEmail) {
    return res.status(400).json({ error: 'recipientEmail required' });
  }

  // Verify ownership
  const video = db.prepare('SELECT user_id FROM videos WHERE id = ?').get(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }

  if (video.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized - not video owner' });
  }

  // Create tracking token (expires in 30 days)
  const payload = {
    e: recipientEmail,
    n: recipientName || '',
    v: videoId,
    x: Date.now() + (30 * 24 * 60 * 60 * 1000)
  };

  const token = generateToken(payload);
  // Use URLSearchParams to ensure correct encoding if needed, but direct append is fine for base64url
  const trackingUrl = `${BASE_URL}/watch/${videoId}?v=${token}`;

  res.json({ trackingUrl, recipientEmail });
});

module.exports = router;
