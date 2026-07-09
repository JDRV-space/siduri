const express = require('express');
const router = express.Router();
const { jwtAuth } = require('../middleware/jwtAuth');
const { generateToken } = require('../lib/token');
const db = require('../lib/db');
const { buildWatchUrl } = require('../lib/requestUrl');
const { isValidEmailAddress } = require('../lib/notificationSettings');

router.post('/:id/share', jwtAuth, (req, res) => {
  const { recipientEmail, recipientName } = req.body;
  const videoId = req.params.id;
  const normalizedRecipientEmail = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';

  if (!isValidEmailAddress(normalizedRecipientEmail)) {
    return res.status(400).json({ error: 'valid recipientEmail required' });
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
    e: normalizedRecipientEmail,
    n: recipientName || '',
    v: videoId,
    x: Date.now() + (30 * 24 * 60 * 60 * 1000)
  };

  const token = generateToken(payload);
  const trackingUrl = buildWatchUrl(req, videoId, { v: token });

  res.json({ trackingUrl, recipientEmail: normalizedRecipientEmail });
});

module.exports = router;
