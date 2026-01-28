// JWT authentication middleware - replaces basicAuth
const jwt = require('jsonwebtoken');
const db = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

// Middleware to verify JWT token from httpOnly cookie OR Authorization header
function jwtAuth(req, res, next) {
  // Check cookie first, then Authorization header (for Chrome extension)
  let token = req.cookies.auth_token;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if token has been revoked (session tokens)
    const revoked = db.prepare('SELECT jti FROM revoked_tokens WHERE jti = ?').get(decoded.jti);
    if (revoked) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // For API tokens (type: 'api'), check api_tokens table for revocation
    if (decoded.type === 'api') {
      const apiToken = db.prepare('SELECT id, revoked_at FROM api_tokens WHERE id = ?').get(decoded.jti);
      if (!apiToken) {
        return res.status(401).json({ error: 'API token not found' });
      }
      if (apiToken.revoked_at) {
        return res.status(401).json({ error: 'API token has been revoked' });
      }
      // Update last_used_at (async, don't block request)
      db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?").run(decoded.jti);
    }

    // Verify user still exists
    const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user to request
    req.user = user;
    req.tokenJti = decoded.jti;

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('JWT auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Optional middleware - allows public access but attaches user if authenticated
function optionalAuth(req, res, next) {
  const token = req.cookies.auth_token;

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if token has been revoked
    const revoked = db.prepare('SELECT jti FROM revoked_tokens WHERE jti = ?').get(decoded.jti);
    if (!revoked) {
      const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(decoded.userId);
      req.user = user || null;
    } else {
      req.user = null;
    }
  } catch (error) {
    req.user = null;
  }

  next();
}

module.exports = { jwtAuth, optionalAuth };
