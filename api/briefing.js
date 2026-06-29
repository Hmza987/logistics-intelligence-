export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fname, lname, email, company } = req.body || {};
  if (!fname || !lname || !email || !company) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const emailBody = `
New briefing request from the GCC Logistics Intelligence Platform:

Name:         ${fname} ${lname}
Email:        ${email}
Organisation: ${company}

---
Sent automatically from the platform briefing form.
  `.trim();

  const payload = {
    from: 'GCC Logistics Platform <onboarding@resend.dev>',
    to: ['hamza.el.mounhi@strategyand.pwc.com'],
    reply_to: email,
    subject: `Briefing Request — ${fname} ${lname} (${company})`,
    text: emailBody,
  };

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Resend error:', err);
      return res.status(502).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Briefing handler error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
