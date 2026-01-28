const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { jwtAuth, optionalAuth } = require('../middleware/jwtAuth');
const db = require('../lib/db');
const { getSignedReadUrl } = require('../lib/gcs');

// POST /api/videos - Register uploaded video in database
router.post('/', jwtAuth, async (req, res) => {
  try {
    const { gcsUrl, title, filename, durationSecs } = req.body;

    if (!gcsUrl || !filename) {
      return res.status(400).json({ error: 'gcsUrl and filename required' });
    }

    const id = uuidv4();
    const stmt = db.prepare(`
      INSERT INTO videos (id, filename, gcs_url, title, duration_secs, user_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, filename, gcsUrl, title || filename, durationSecs || null, req.user.id);

    res.json({
      id,
      watchUrl: `/watch/${id}`,
      trackingUrl: `${req.protocol}://${req.get('host')}/watch/${id}`
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

      // GIF URL follows naming convention: videos/{id}.gif (handles .mp4 and .webm)
      const gifUrl = video.gcs_url
        ? video.gcs_url.replace(/\.(mp4|webm)$/i, '.gif')
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

    // Generate signed URL for video playback
    const gcsPath = video.gcs_url.replace(`https://storage.googleapis.com/${process.env.GCS_BUCKET}/`, '');
    const signedUrl = await getSignedReadUrl(gcsPath);

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
      const stmt = db.prepare('UPDATE videos SET duration_secs = ? WHERE id = ?');
      stmt.run(duration_secs, id);
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
