const express = require('express');
const router = express.Router();
const { jwtAuth } = require('../middleware/jwtAuth');
const db = require('../lib/db');
const { buildWatchUrl } = require('../lib/requestUrl');
const { isValidEmailAddress } = require('../lib/notificationSettings');
const { createShareToken } = require('../lib/shares');

router.post('/:id/share', jwtAuth, (req, res) => {
  const { recipientEmail, recipientName } = req.body;
  const videoId = req.params.id;
  const normalizedRecipientEmail = typeof recipientEmail === 'string' ? recipientEmail.trim() : '';
  const normalizedRecipientName = typeof recipientName === 'string' ? recipientName.trim() : '';

  if (!isValidEmailAddress(normalizedRecipientEmail) || normalizedRecipientEmail.length > 320) {
    return res.status(400).json({ error: 'valid recipientEmail required' });
  }
  if (normalizedRecipientName.length > 200) {
    return res.status(400).json({ error: 'recipientName must be 200 characters or fewer' });
  }

  // Verify ownership
  const video = db.prepare('SELECT user_id FROM videos WHERE id = ?').get(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Video not found' });
  }

  if (video.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Unauthorized - not video owner' });
  }

  // Store recipient data server-side. The URL token contains only opaque IDs.
  const token = createShareToken({
    videoId,
    recipientEmail: normalizedRecipientEmail,
    recipientName: normalizedRecipientName
  });
  const trackingUrl = buildWatchUrl(req, videoId, { v: token });

  res.json({ trackingUrl, recipientEmail: normalizedRecipientEmail });
});

module.exports = router;
