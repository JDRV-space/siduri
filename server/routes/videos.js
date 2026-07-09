const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { jwtAuth, optionalAuth } = require('../middleware/jwtAuth');
const db = require('../lib/db');
const { getPublicGcsUrl, getSignedReadUrl, getVideoObjectPath } = require('../lib/gcs');
const { buildWatchUrl } = require('../lib/requestUrl');

const SAFE_VIDEO_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$/i;

function getStoredVideoObjectPath(filename) {
  if (typeof filename !== 'string' || !SAFE_VIDEO_FILENAME.test(filename)) {
    return null;
  }

  return getVideoObjectPath(filename);
}

function parseDurationSecs(durationSecs) {
  if (durationSecs === undefined || durationSecs === null || durationSecs === '') {
    return null;
  }

  const parsed = Number(durationSecs);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 86400) {
    return null;
  }

  return parsed;
}

// POST /api/videos - Register uploaded video in database
router.post('/', jwtAuth, async (req, res) => {
  try {
    const { uploadId, title, durationSecs } = req.body;

    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId required' });
    }

    const pendingUpload = db.prepare(`
      SELECT *
      FROM pending_uploads
      WHERE id = ?
        AND user_id = ?
        AND consumed_at IS NULL
        AND expires_at > datetime('now')
    `).get(uploadId, req.user.id);

    if (!pendingUpload) {
      return res.status(400).json({ error: 'Invalid or expired uploadId' });
    }

    const duration = parseDurationSecs(durationSecs);
    if (durationSecs !== undefined && duration === null) {
      return res.status(400).json({ error: 'durationSecs must be a positive number (max 86400)' });
    }

    const gcsUrl = getPublicGcsUrl(pendingUpload.object_path);
    const id = uuidv4();
    const createVideo = db.transaction(() => {
      db.prepare(`
        INSERT INTO videos (id, filename, gcs_url, title, duration_secs, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        pendingUpload.filename,
        gcsUrl,
        title || pendingUpload.filename,
        duration,
        req.user.id
      );

      db.prepare(`
        UPDATE pending_uploads
        SET consumed_at = datetime('now')
        WHERE id = ?
      `).run(uploadId);
    });

    createVideo();

    res.json({
      id,
      watchUrl: buildWatchUrl(req, id),
      trackingUrl: null
    });

  } catch (error) {
    console.error('Videos error:', error);
    res.status(500).json({ error: 'Failed to register video' });
  }
});

// GET /api/videos - List all videos (for dashboard) - filtered by user
router.get('/', jwtAuth, async (req, res) => {
  try {
    // Only return videos owned by this user
    const videos = db.prepare('SELECT * FROM videos WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);

    // Get view stats for each video
    const videosWithStats = videos.map(video => {
      const views = db.prepare('SELECT * FROM views WHERE video_id = ?').all(video.id);

      const totalViews = views.length;
      const totalWatchSecs = views.reduce((sum, v) => sum + (v.watch_secs || 0), 0);
      const avgCompletion = video.duration_secs && totalViews > 0
        ? Math.round((totalWatchSecs / totalViews / video.duration_secs) * 100)
        : 0;

      const objectPath = getStoredVideoObjectPath(video.filename);
      const gifUrl = objectPath
        ? getPublicGcsUrl(objectPath.replace(/\.(mp4|webm)$/i, '.gif'))
        : null;

      return {
        ...video,
        gifUrl,
        stats: {
          totalViews,
          totalWatchSecs,
          avgCompletion: Math.min(avgCompletion, 100)
        },
        views
      };
    });

    res.json(videosWithStats);

  } catch (error) {
    console.error('List videos error:', error);
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// GET /api/videos/:id - Get single video details (public for player)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);

    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const objectPath = getStoredVideoObjectPath(video.filename);
    if (!objectPath) {
      return res.status(500).json({ error: 'Video storage path invalid' });
    }

    // Generate signed URL for video playback from the server-owned object path.
    const signedUrl = await getSignedReadUrl(objectPath);

    res.json({
      id: video.id,
      title: video.title,
      filename: video.filename,
      durationSecs: video.duration_secs,
      created_at: video.created_at,
      videoUrl: signedUrl
    });

  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ error: 'Failed to get video' });
  }
});

// PATCH /api/videos/:id - Update video metadata
// Uses optionalAuth - duration_secs updates are public (from player), title updates require auth
router.patch('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { duration_secs, title } = req.body;

    // Title updates require authentication and ownership
    if (title !== undefined) {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to update title' });
      }

      const video = db.prepare('SELECT user_id FROM videos WHERE id = ?').get(id);
      if (!video) {
        return res.status(404).json({ error: 'Video not found' });
      }

      if (video.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Unauthorized - not video owner' });
      }

      const stmt = db.prepare('UPDATE videos SET title = ? WHERE id = ?');
      stmt.run(title, id);
    }

    // Duration updates are public (called from player.js after video loads)
    if (duration_secs !== undefined) {
      const dur = Number(duration_secs);
      if (!Number.isFinite(dur) || dur <= 0 || dur > 86400) {
        return res.status(400).json({ error: 'duration_secs must be a positive number (max 86400)' });
      }
      const stmt = db.prepare('UPDATE videos SET duration_secs = ? WHERE id = ?');
      stmt.run(dur, id);
    }

    if (duration_secs === undefined && title === undefined) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ error: 'Failed to update video' });
  }
});

// DELETE /api/videos/:id - Delete video (with ownership check)
router.delete('/:id', jwtAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const video = db.prepare('SELECT user_id FROM videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    if (video.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized - not video owner' });
    }

    const stmt = db.prepare('DELETE FROM videos WHERE id = ?');
    stmt.run(id);

    res.json({ success: true });

  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

module.exports = router;
