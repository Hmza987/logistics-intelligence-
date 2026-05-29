'use strict';
// Auth removed — clear any legacy session cookie and send to dashboard
module.exports = async (req, res) => {
  res.setHeader('Set-Cookie', 'gcc_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.setHeader('Location', '/');
  return res.status(302).end();
};
