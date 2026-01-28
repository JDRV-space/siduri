const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const { jwtAuth } = require('../middleware/jwtAuth');
const { isAccountLocked, recordLoginAttempt } = require('../lib/rateLimit');
const { sendPasswordResetEmail } = require('../lib/email');

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '24h';

// Email domain allowlist - configurable via environment variable
// If empty or not set, all domains are allowed (open source flexibility)
const ALLOWED_EMAIL_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS?.split(',').map(d => d.trim().toLowerCase()).filter(Boolean) || [];

function isEmailAllowed(email) {
  // If no domains configured, allow all (open source mode)
  if (ALLOWED_EMAIL_DOMAINS.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  return ALLOWED_EMAIL_DOMAINS.includes(domain);
}

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}

// POST /api/auth/register - Invitation-only registration
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, inviteCode } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check email domain allowlist (if configured)
    if (!isEmailAllowed(email)) {
      const allowedDomains = ALLOWED_EMAIL_DOMAINS.map(d => `@${d}`).join(', ');
      return res.status(400).json({ error: `Only ${allowedDomains} email addresses are allowed` });
    }

    // Check password strength (minimum 12 characters)
    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    // Check if this is the first user (becomes owner)
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const isFirstUser = userCount.count === 0;

    if (!isFirstUser) {
      // Require invitation code for non-first users
      if (!inviteCode) {
        return res.status(400).json({ error: 'Invitation code required' });
      }

      // Verify invitation code
      const invitation = db.prepare(`
        SELECT * FROM invitations
        WHERE code = ? AND used_at IS NULL AND expires_at > datetime('now')
      `).get(inviteCode);

      if (!invitation) {
        return res.status(400).json({ error: 'Invalid or expired invitation code' });
      }

      // Check email matches invitation (if specified)
      if (invitation.email && invitation.email !== email) {
        return res.status(400).json({ error: 'Invitation is for a different email address' });
      }
    }

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const userId = uuidv4();
    const role = isFirstUser ? 'owner' : 'member';

    db.prepare(`
      INSERT INTO users (id, email, password_hash, name, role)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, email, passwordHash, name || null, role);

    // Mark invitation as used
    if (!isFirstUser) {
      db.prepare(`
        UPDATE invitations SET used_at = datetime('now') WHERE code = ?
      `).run(inviteCode);
    }

    // Generate JWT token
    const jti = uuidv4();
    const token = jwt.sign(
      { userId, email, role, jti },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    // Set httpOnly cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      success: true,
      user: { id: userId, email, name, role }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login - Timing-safe login with account lockout
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Check if account is locked
    const lockStatus = isAccountLocked(email);
    if (lockStatus.locked) {
      return res.status(429).json({
        error: 'Account temporarily locked due to multiple failed login attempts',
        retryAfter: Math.ceil(lockStatus.duration / 1000)
      });
    }

    // Always fetch user and hash to prevent timing attacks
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    // Always hash the password (even if user doesn't exist) to prevent timing attacks
    const passwordToCheck = password;
    let isValid = false;

    if (user) {
      isValid = await bcrypt.compare(passwordToCheck, user.password_hash);
    } else {
      // Run bcrypt anyway to maintain consistent timing
      await bcrypt.compare(passwordToCheck, '$2b$12$invalidhashforconsistenttiming000000000000000000000000000');
    }

    if (!isValid || !user) {
      // Record failed attempt
      recordLoginAttempt(email, false);

      // Generic error message
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Record successful login
    recordLoginAttempt(email, true);

    // Generate JWT token
    const jti = uuidv4();
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, jti },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    // Set httpOnly cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout - Revoke token
router.post('/logout', jwtAuth, (req, res) => {
  try {
    const { tokenJti } = req;

    // Add token to revoked list (expires in 24 hours)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO revoked_tokens (jti, expires_at)
      VALUES (?, ?)
    `).run(tokenJti, expiresAt);

    // Clear cookie
    res.clearCookie('auth_token');

    res.json({ success: true });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me - Get current user
router.get('/me', jwtAuth, (req, res) => {
  res.json({
    user: req.user
  });
});

// GET /api/auth/check-first-user - Check if this is the first user (public)
router.get('/check-first-user', (req, res) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    res.json({ isFirstUser: userCount.count === 0 });
  } catch (error) {
    console.error('Check first user error:', error);
    res.status(500).json({ error: 'Failed to check user status' });
  }
});

// POST /api/auth/refresh - Refresh token
router.post('/refresh', jwtAuth, (req, res) => {
  try {
    const { user, tokenJti } = req;

    // Revoke old token
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO revoked_tokens (jti, expires_at)
      VALUES (?, ?)
    `).run(tokenJti, expiresAt);

    // Generate new token
    const newJti = uuidv4();
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, jti: newJti },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    // Set httpOnly cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Refresh error:', error);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// POST /api/auth/api-token - Generate long-lived API token for Chrome extension
router.post('/api-token', jwtAuth, (req, res) => {
  try {
    const { user } = req;
    const { name = 'Chrome Extension' } = req.body;

    // Generate token ID for tracking/revocation
    const tokenId = uuidv4();

    // Generate long-lived token (30 days)
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, jti: tokenId, type: 'api' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Store token in database for revocation tracking
    db.prepare(`
      INSERT INTO api_tokens (id, user_id, name)
      VALUES (?, ?, ?)
    `).run(tokenId, user.id, name);

    res.json({
      token,
      tokenId,
      expiresIn: '30 days',
      usage: 'Use as Authorization: Bearer <token> header'
    });

  } catch (error) {
    console.error('API token error:', error);
    res.status(500).json({ error: 'Failed to generate API token' });
  }
});

// GET /api/auth/api-tokens - List user's API tokens
router.get('/api-tokens', jwtAuth, (req, res) => {
  try {
    const tokens = db.prepare(`
      SELECT id, name, created_at, last_used_at, revoked_at
      FROM api_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
    `).all(req.user.id);

    res.json(tokens);
  } catch (error) {
    console.error('List API tokens error:', error);
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

// DELETE /api/auth/api-tokens/:id - Revoke an API token
router.delete('/api-tokens/:id', jwtAuth, (req, res) => {
  try {
    const { id } = req.params;

    // Verify token belongs to user
    const token = db.prepare('SELECT user_id FROM api_tokens WHERE id = ?').get(id);
    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }
    if (token.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Mark as revoked (soft delete)
    db.prepare(`
      UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = ?
    `).run(id);

    res.json({ success: true, message: 'Token revoked' });
  } catch (error) {
    console.error('Revoke API token error:', error);
    res.status(500).json({ error: 'Failed to revoke token' });
  }
});

// POST /api/auth/invitations - Create invitation (admin/owner only)
router.post('/invitations', jwtAuth, (req, res) => {
  try {
    const { email, expiresInDays = 7 } = req.body;
    const { user } = req;

    // Only owners and admins can create invitations
    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Generate invitation code
    const code = uuidv4();
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO invitations (code, email, created_by, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(code, email || null, user.id, expiresAt);

    res.json({
      code,
      email,
      expiresAt
    });

  } catch (error) {
    console.error('Create invitation error:', error);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

// GET /api/auth/invitations - List invitations (admin/owner only)
router.get('/invitations', jwtAuth, (req, res) => {
  try {
    const { user } = req;

    if (user.role !== 'owner' && user.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const invitations = db.prepare(`
      SELECT code, email, created_by, used_at, expires_at
      FROM invitations
      ORDER BY created_at DESC
    `).all();

    res.json({ invitations });

  } catch (error) {
    console.error('List invitations error:', error);
    res.status(500).json({ error: 'Failed to list invitations' });
  }
});

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Always return success to prevent email enumeration attacks
    const successResponse = { success: true, message: 'If an account exists, a reset email has been sent' };

    // Find user by email
    const user = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email);

    if (!user) {
      // Return success even if user doesn't exist (prevent enumeration)
      return res.json(successResponse);
    }

    // Generate secure random token
    const token = crypto.randomBytes(32).toString('hex');

    // Hash the token for storage (never store plain tokens)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Set expiry to 1 hour from now
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // Store hashed token in database
    const tokenId = uuidv4();
    db.prepare(`
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenId, user.id, tokenHash, expiresAt);

    // Build reset URL
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;

    // Send email (logs to console if SMTP not configured)
    await sendPasswordResetEmail(user.email, resetUrl);

    res.json(successResponse);

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password required' });
    }

    // Validate password length
    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    // Hash the received token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find matching unexpired token
    const resetToken = db.prepare(`
      SELECT id, user_id
      FROM password_reset_tokens
      WHERE token_hash = ?
        AND expires_at > datetime('now')
        AND used_at IS NULL
    `).get(tokenHash);

    if (!resetToken) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Update user password
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, resetToken.user_id);

    // Mark token as used
    db.prepare(`
      UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?
    `).run(resetToken.id);

    res.json({ success: true, message: 'Password has been reset successfully' });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
