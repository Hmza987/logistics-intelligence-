'use strict';
module.exports = async (req, res) => {
  res.setHeader('Set-Cookie', 'gcc_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0; Secure');
  res.setHeader('Location', '/login.html');
  return res.status(302).end();
};
