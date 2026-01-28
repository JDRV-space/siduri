const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { jwtAuth } = require('../middleware/jwtAuth');
const { getSignedUploadUrl } = require('../lib/gcs');
const db = require('../lib/db');

// Max file size: 100MB
const MAX_SIZE = 100 * 1024 * 1024;
// MP4 for manual uploads, WebM for MediaRecorder recordings (Chrome/Firefox)
const ALLOWED_TYPES = ['video/mp4', 'video/webm'];

// Upload limits per user (prevents GIF generation DoS)
const MAX_UPLOADS_PER_HOUR = 10;

// Helper to check if content type is allowed (handles codec strings like "video/webm;codecs=vp9,opus")
function isAllowedType(contentType) {
  if (!contentType) return false;
  const baseType = contentType.split(';')[0].trim().toLowerCase();
  return ALLOWED_TYPES.includes(baseType);
}

// Check user upload count in last hour
function getUserUploadCount(userId) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM videos
    WHERE user_id = ? AND created_at > ?
  `).get(userId, oneHourAgo);
  return result?.count || 0;
}

// POST /api/upload - Get signed URL for direct GCS upload
router.post('/', jwtAuth, async (req, res) => {
  try {
    const { filename, contentType, size } = req.body;

    // Check per-user upload limit (prevents GIF generation DoS)
    const uploadCount = getUserUploadCount(req.user.id);
    if (uploadCount >= MAX_UPLOADS_PER_HOUR) {
      return res.status(429).json({
        error: `Upload limit reached (${MAX_UPLOADS_PER_HOUR} videos/hour). Please wait and try again.`
      });
    }

    // Validate request
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType required' });
    }

    // Validate file type (handles codec strings like "video/webm;codecs=vp9")
    if (!isAllowedType(contentType)) {
      return res.status(400).json({
        error: 'Invalid file type. Allowed: mp4 or webm'
      });
    }

    // Validate file size (required)
    if (!size) {
      return res.status(400).json({ error: 'size required' });
    }
    if (size > MAX_SIZE) {
      return res.status(413).json({
        error: 'File too large. Max 100MB'
      });
    }

    // Generate unique filename (handle files without extension)
    const ext = filename.includes('.') ? filename.split('.').pop() : 'mp4';
    const uniqueFilename = `${uuidv4()}.${ext}`;

    // Get signed URL for upload
    const { uploadUrl, gcsUrl } = await getSignedUploadUrl(uniqueFilename, contentType);

    res.json({
      uploadUrl,
      gcsUrl,
      filename: uniqueFilename,
      expiresIn: 3600 // 1 hour
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

module.exports = router;
