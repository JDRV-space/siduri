function requireAdminOrOwner(req, res, next) {
  const role = req.user?.role;
  if (role !== 'owner' && role !== 'admin') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  next();
}

module.exports = { requireAdminOrOwner };
