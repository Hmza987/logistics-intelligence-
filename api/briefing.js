'use strict';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = '';
  for await (const chunk of req) body += chunk;
  let data;
  try { data = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { fname, lname, email, company } = data || {};
  if (!fname || !lname || !email || !company) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const emailBody = [
    'New demo request from the GCC Logistics Intelligence Platform:',
    '',
    `Name:         ${fname} ${lname}`,
    `Email:        ${email}`,
    `Organisation: ${company}`,
    '',
    '---',
    'Sent automatically from the platform demo request form.',
  ].join('\n');

  const payload = {
    from: 'GCC Logistics Platform <onboarding@resend.dev>',
    to: ['hamza.el.mounhi@strategyand.pwc.com'],
    reply_to: email,
    subject: `Demo Request — ${fname} ${lname} (${company})`,
    text: emailBody,
  };

  const https = require('https');
  const postData = JSON.stringify(payload);

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const reqOut = https.request(options, (resOut) => {
      let raw = '';
      resOut.on('data', (c) => { raw += c; });
      resOut.on('end', () => {
        if (resOut.statusCode >= 200 && resOut.statusCode < 300) {
          res.status(200).json({ ok: true });
        } else {
          console.error('Resend error:', resOut.statusCode, raw);
          res.status(502).json({ error: 'Failed to send email' });
        }
        resolve();
      });
    });

    reqOut.on('error', (err) => {
      console.error('Briefing handler error:', err);
      res.status(500).json({ error: 'Internal error' });
      resolve();
    });

    reqOut.write(postData);
    reqOut.end();
  });
};
