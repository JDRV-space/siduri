require('dotenv').config();
const { validateEnv } = require('./lib/validateEnv');
validateEnv(); // Fail fast if env vars missing

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./lib/db');

const app = express();
const PORT = parseInt(process.env.PORT) || 8080;

// Trust proxy for Cloud Run (1 = trust first proxy only)
app.set('trust proxy', 1);

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per 15 min
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// Security middleware
// CSP configured to allow MediaPipe/WebAssembly ('unsafe-eval'), inline styles,
// CDN resources (Video.js, MediaPipe), and Google Cloud Storage for media assets
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-eval'", "cdn.jsdelivr.net", "vjs.zencdn.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "vjs.zencdn.net", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "storage.googleapis.com"],
      mediaSrc: ["'self'", "blob:", "storage.googleapis.com"],
      connectSrc: ["'self'", "storage.googleapis.com"],
      workerSrc: ["'self'", "blob:"],
    }
  }
}));

// CORS - use environment variable for allowed origins
// Set ALLOWED_ORIGINS env var for production (comma-separated)
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8080'
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, '../public')));
// Alias for base href (production uses /video/studio/ via load balancer)
app.use('/video/studio', express.static(path.join(__dirname, '../public')));

// Mount API at both paths for local testing
// (Production uses load balancer path rewriting from /video/studio/* to /*)
const apiPaths = ['/api', '/video/studio/api'];

// Routes
const uploadRoutes = require('./routes/upload');
const videosRoutes = require('./routes/videos');
const trackRoutes = require('./routes/track');
const healthRoutes = require('./routes/health');
const shareRoutes = require('./routes/share');
const settingsRoutes = require('./routes/settings');
const authRoutes = require('./routes/auth');

// Apply rate limiters and mount routes at both paths
// (supports both /api/* and /video/studio/api/* for local testing)
apiPaths.forEach(basePath => {
  app.use(`${basePath}/auth/login`, authLimiter);
  app.use(`${basePath}/auth/register`, authLimiter);
  app.use(basePath, apiLimiter);

  app.use(`${basePath}/auth`, authRoutes);
  app.use(`${basePath}/upload`, uploadRoutes);
  app.use(`${basePath}/videos`, videosRoutes);
  app.use(`${basePath}/videos`, shareRoutes);
  app.use(`${basePath}/track`, trackRoutes);
  app.use(`${basePath}/settings`, settingsRoutes);
});
app.use('/health', healthRoutes);

// Serve pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/watch/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/watch.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/settings.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);

  // Handle CORS errors with a clearer message
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS: Origin not allowed' });
  }

  res.status(500).json({ error: 'Internal server error' });
});

// Cleanup expired revoked tokens (runs hourly)
function cleanupRevokedTokens() {
  try {
    const result = db.prepare(`
      DELETE FROM revoked_tokens WHERE expires_at < datetime('now')
    `).run();
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} expired revoked tokens`);
    }
  } catch (error) {
    console.error('Token cleanup error:', error);
  }
}

// Run cleanup on startup and every hour
cleanupRevokedTokens();
setInterval(cleanupRevokedTokens, 60 * 60 * 1000); // 1 hour

app.listen(PORT, () => {
  console.log(`siduri running on port ${PORT}`);
});
