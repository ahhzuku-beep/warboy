require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const validator = require('validator');

const app = express();
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// serve resources folder (place logovideo.mp4 in ./resources)
app.use('/resources', express.static(path.join(__dirname, 'resources')));

// rate limit
const limiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Too many submissions, try again later.' });
app.use('/submit', limiter);

// helper sanitize
function sanitizeInput(s) {
  if (!s) return '';
  return String(s).trim();
}

// create transporter (Ethereal fallback)
async function createTransporter() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }

  // fallback to Ethereal test account
  const testAccount = await nodemailer.createTestAccount();
  return nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: { user: testAccount.user, pass: testAccount.pass }
  });
}

// helper: subscribers storage
const SUB_FILE = path.join(__dirname, 'subscribers.json');
function loadSubscribers(){
  if(!fs.existsSync(SUB_FILE)) return {};
  try{ return JSON.parse(fs.readFileSync(SUB_FILE,'utf8') || '{}'); }catch(e){ console.error('Failed to parse subscribers.json', e); return {}; }
}
function saveSubscribers(obj){ try{ fs.writeFileSync(SUB_FILE, JSON.stringify(obj, null, 2)); }catch(e){ console.error('Failed to write subscribers.json', e); } }
function addSubscriber(name, email, consent){ const key = String(email).toLowerCase(); const subs = loadSubscribers(); subs[key] = { name: name || '', email: key, consent: !!consent, time: new Date().toISOString() }; saveSubscribers(subs); return subs[key]; }

// endpoint to collect signups (name + email + consent)
app.post('/submit', async (req, res) => {
  try {
    const name = sanitizeInput(req.body.name || req.query.name);
    const email = sanitizeInput(req.body.email || req.query.email);
    const consentRaw = req.body.consent || req.query.consent || '';
    const consent = (String(consentRaw) === 'on' || String(consentRaw) === 'true' || String(consentRaw) === '1');

    if (!name || !email) return res.status(400).send('Missing required fields');
    if (!validator.isEmail(email)) return res.status(400).send('Invalid email');

    // record submission
    const record = { time: new Date().toISOString(), ip: req.ip, name, email, consent };
    fs.appendFile(path.join(__dirname, 'submissions.log'), JSON.stringify(record) + '\n', (err) => {
      if (err) console.error('Failed to write log', err);
    });

    // if consent given, add to subscribers list (deduped by email)
    let subscriber = null;
    if (consent) {
      subscriber = addSubscriber(name, email, consent);
      console.log('Added subscriber:', subscriber.email);
    }

    const transporter = await createTransporter();

    // Send admin notification (you can customize TO_EMAIL in env) that a signup occurred
    const mailOptions = {
      from: process.env.FROM_EMAIL || 'no-reply@example.com',
      to: process.env.TO_EMAIL || process.env.FROM_EMAIL || 'recipient@example.com',
      subject: process.env.EMAIL_SUBJECT || `New signup from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nConsent: ${consent}`,
      html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Consent:</strong> ${consent}</p>`
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);

    // log sent record
    const sentRecord = Object.assign({}, { time: record.time, ip: record.ip, name: record.name, email: record.email, consent: record.consent }, { previewUrl, messageId: info.messageId });
    fs.appendFile(path.join(__dirname, 'submissions.log'), JSON.stringify(sentRecord) + '\n', (err) => {
      if (err) console.error('Failed to write sent log', err);
    });

    console.log('Email preview URL:', previewUrl);

    res.json({ status: 'ok', previewUrl, subscribed: !!subscriber });
  } catch (err) {
    console.error('Submit error', err);
    res.status(500).send('Server error');
  }
});

// Returns recent submissions (newest first)
app.get('/recent', (req, res) => {
  const logPath = path.join(__dirname, 'submissions.log');
  if (!fs.existsSync(logPath)) return res.json([]);
  const data = fs.readFileSync(logPath, 'utf8').trim();
  if (!data) return res.json([]);
  const lines = data.split(/\r?\n/).filter(Boolean);
  const arr = [];
  for (let i = Math.max(0, lines.length - 20); i < lines.length; i++) {
    try { arr.push(JSON.parse(lines[i])); } catch (e) { }
  }
  // newest first but only expose non-sensitive fields (no message)
  const results = arr.reverse().map(it => ({ time: it.time, ip: it.ip, name: it.name, email: it.email, previewUrl: it.previewUrl, messageId: it.messageId }));
  res.json(results);
});

// Diagnostic: list files in resources folder
app.get('/resources/list', (req, res) => {
  const dir = path.join(__dirname, 'resources');
  if (!fs.existsSync(dir)) return res.json([]);
  try {
    const files = fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile()).map(f => {
      const s = fs.statSync(path.join(dir, f));
      return { name: f, size: s.size };
    });
    return res.json(files);
  } catch (e) {
    console.error('Failed listing resources', e);
    return res.status(500).send('error');
  }
});

// admin token checker middleware
function requireAdmin(req, res, next){
  const token = req.headers['x-admin-token'] || req.query.admin_token;
  if(!process.env.ADMIN_TOKEN) return res.status(403).send('Admin token not configured');
  if(!token || token !== process.env.ADMIN_TOKEN) return res.status(401).send('Unauthorized');
  return next();
}

// list subscribers (admin only)
app.get('/subscribers', requireAdmin, (req, res) => {
  const subs = loadSubscribers();
  return res.json(Object.values(subs));
});

// announce endpoint (admin only) - send announcement to all consenting subscribers
app.post('/admin/announce', requireAdmin, async (req, res) => {
  try{
    const subject = sanitizeInput(req.body.subject || req.query.subject || 'Announcement');
    const message = sanitizeInput(req.body.message || req.query.message || 'We have a new drop!');
    const html = req.body.html || req.query.html || `<p>${message}</p>`;
    const subs = loadSubscribers();
    const recipients = Object.values(subs).filter(s => s.consent).map(s => s.email);
    if(!recipients || recipients.length === 0) return res.status(400).send('No consenting subscribers');

    const transporter = await createTransporter();

    // send as BCC to all recipients (be careful in production - consider batching)
    const mailOptions = {
      from: process.env.FROM_EMAIL || 'no-reply@example.com',
      bcc: recipients.join(','),
      subject,
      text: message,
      html
    };

    const info = await transporter.sendMail(mailOptions);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    // log announcement
    const annRecord = { time: new Date().toISOString(), subject, recipientCount: recipients.length, previewUrl };
    fs.appendFile(path.join(__dirname, 'submissions.log'), JSON.stringify(annRecord) + '\n', (err) => { if(err) console.error('Failed to write ann log', err); });
    return res.json({ ok: true, recipientCount: recipients.length, previewUrl });
  }catch(e){ console.error('Announce error', e); return res.status(500).send('Error sending announcement'); }
});

// Diagnostic: info about a single resource file
app.get('/resources/info', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).send('missing file');
  const p = path.join(__dirname, 'resources', file);
  if (!fs.existsSync(p)) return res.status(404).send('not found');
  try {
    const s = fs.statSync(p);
    return res.json({ name: file, size: s.size, mtime: s.mtime });
  } catch (e) {
    console.error('Failed resource info', e);
    return res.status(500).send('error');
  }
});

// serve index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
