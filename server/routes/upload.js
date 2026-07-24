const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { jwtAuth } = require('../middleware/jwtAuth');
const { getSignedUploadUrl, getVideoObjectPath } = require('../lib/gcs');
const db = require('../lib/db');

// Max file size: 100MB
const MAX_SIZE = 100 * 1024 * 1024;
// MP4 for manual uploads, WebM for MediaRecorder recordings (Chrome/Firefox)
const ALLOWED_TYPES = ['video/mp4', 'video/webm'];

// Upload limits per user (prevents GIF generation DoS)
const MAX_UPLOADS_PER_HOUR = 10;
const UPLOAD_URL_TTL_MS = 60 * 60 * 1000;

// Helper to check if content type is allowed (handles codec strings like "video/webm;codecs=vp9,opus")
function isAllowedType(contentType) {
  const baseType = getBaseContentType(contentType);
  return ALLOWED_TYPES.includes(baseType);
}

function getBaseContentType(contentType) {
  if (!contentType) return '';
  return contentType.split(';')[0].trim().toLowerCase();
}

function getExtensionForContentType(contentType) {
  const baseType = getBaseContentType(contentType);
  if (baseType === 'video/webm') return 'webm';
  return 'mp4';
}

function toSqliteDateTime(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

// Check user upload count in last hour
function getUserUploadCount(userId) {
  const oneHourAgo = toSqliteDateTime(new Date(Date.now() - 60 * 60 * 1000));
  const videoCount = db.prepare(`
    SELECT COUNT(*) as count FROM videos
    WHERE user_id = ? AND created_at > ?
  `).get(userId, oneHourAgo);
  const pendingCount = db.prepare(`
    SELECT COUNT(*) as count FROM pending_uploads
    WHERE user_id = ?
      AND consumed_at IS NULL
      AND expires_at > datetime('now')
      AND created_at > ?
  `).get(userId, oneHourAgo);

  return (videoCount?.count || 0) + (pendingCount?.count || 0);
}

function reservePendingUpload(pendingUpload) {
  const reserve = db.transaction(() => {
    if (getUserUploadCount(pendingUpload.userId) >= MAX_UPLOADS_PER_HOUR) {
      return false;
    }

    db.prepare(`
      INSERT INTO pending_uploads (id, user_id, filename, object_path, content_type, size, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      pendingUpload.id,
      pendingUpload.userId,
      pendingUpload.filename,
      pendingUpload.objectPath,
      pendingUpload.contentType,
      pendingUpload.size,
      pendingUpload.expiresAt
    );
    return true;
  });

  return reserve();
}

// POST /api/upload - Get signed URL for direct GCS upload
router.post('/', jwtAuth, async (req, res) => {
  try {
    const { filename, contentType, size } = req.body;

    db.prepare(`
      DELETE FROM pending_uploads
      WHERE expires_at < datetime('now')
    `).run();

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
    const parsedSize = Number(size);
    if (!Number.isInteger(parsedSize) || parsedSize <= 0) {
      return res.status(400).json({ error: 'size required' });
    }
    if (parsedSize > MAX_SIZE) {
      return res.status(413).json({
        error: 'File too large. Max 100MB'
      });
    }

    // Use the verified content type for extension selection, not user input.
    const normalizedContentType = getBaseContentType(contentType);
    const ext = getExtensionForContentType(normalizedContentType);
    const uniqueFilename = `${uuidv4()}.${ext}`;
    const uploadId = uuidv4();
    const objectPath = getVideoObjectPath(uniqueFilename);
    const expiresAt = toSqliteDateTime(new Date(Date.now() + UPLOAD_URL_TTL_MS));

    // Reserve quota synchronously before signing. The transaction prevents
    // concurrent requests from all observing the same remaining capacity.
    const reserved = reservePendingUpload({
      id: uploadId,
      userId: req.user.id,
      filename: uniqueFilename,
      objectPath,
      contentType: normalizedContentType,
      size: parsedSize,
      expiresAt
    });
    if (!reserved) {
      return res.status(429).json({
        error: `Upload limit reached (${MAX_UPLOADS_PER_HOUR} videos/hour). Please wait and try again.`
      });
    }

    let uploadUrl;
    let uploadHeaders;
    try {
      // GCS enforces exact size, content type, and signed upload metadata.
      ({ uploadUrl, uploadHeaders } = await getSignedUploadUrl({
        filename: uniqueFilename,
        contentType: normalizedContentType,
        size: parsedSize,
        uploadId,
        userId: req.user.id
      }));
    } catch (error) {
      db.prepare(`
        DELETE FROM pending_uploads
        WHERE id = ? AND user_id = ? AND consumed_at IS NULL
      `).run(uploadId, req.user.id);
      throw error;
    }

    res.json({
      uploadId,
      uploadUrl,
      uploadHeaders,
      filename: uniqueFilename,
      expiresIn: 3600 // 1 hour
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

module.exports = router;
