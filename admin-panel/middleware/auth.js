function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  if (req.path === '/login' || req.path.startsWith('/api/login')) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login');
}

module.exports = { requireAuth };
