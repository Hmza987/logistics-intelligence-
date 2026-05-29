'use strict';
// Auth removed — always return 200 so any legacy checks don't redirect
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({ ok: true });
};
