const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// GET /health - Health check for Cloud Run
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  // Check SQLite connection
  try {
    db.prepare('SELECT 1').get();
    health.checks.database = 'ok';
  } catch (e) {
    health.checks.database = 'error';
  }

  // Overall status
  const hasErrors = Object.values(health.checks).includes('error');
  health.status = hasErrors ? 'degraded' : 'ok';

  res.status(hasErrors ? 503 : 200).json(health);
});

module.exports = router;
