'use strict';
module.exports = async (req, res) => {
  res.setHeader('Set-Cookie', 'gcc_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.setHeader('Location', '/login');
  return res.status(302).end();
};
