'use strict';
require('./lib/env');

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const { sendOrderEmails, emailConfigured, OWNER_EMAIL } = require('./lib/email');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'fancyraccoon2026';
const ADMIN_SECRET =
  process.env.ADMIN_SECRET || crypto.createHash('sha256').update(`fr-admin::${ADMIN_PASSWORD}`).digest('hex');
const SESSION_MS = 1000 * 60 * 60 * 8;

// Pricing rules (single source of truth; the client reads them from /api/config)
const PRICING = {
  customizationFee: 99,
  shippingFlat: 79,
  freeShippingOver: 1499,
  currency: 'INR',
};

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const REFERENCE_DIR = path.join(UPLOAD_DIR, 'reference');
fs.mkdirSync(REFERENCE_DIR, { recursive: true });

store.init();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// ---------------------------------------------------------------- admin auth
function signAdminToken() {
  const payload = `admin.${Date.now() + SESSION_MS}`;
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [scope, expiry, sig] = parts;
  if (scope !== 'admin') return false;
  const expected = crypto.createHmac('sha256', ADMIN_SECRET).update(`${scope}.${expiry}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expiry) > Date.now();
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function requireAdmin(req, res, next) {
  if (!verifyAdminToken(readCookie(req, 'fr_admin'))) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
}

// Crude but effective in-memory throttle for the login + public write routes.
const buckets = new Map();
function throttle(key, limit, windowMs) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

// ------------------------------------------------------------------ uploads
const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, REFERENCE_DIR);
  },
  filename(req, file, cb) {
    const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 8);
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(ext) ? ext : '.jpg';
    cb(null, `${Date.now()}-${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 6 },
  fileFilter(req, file, cb) {
    if (!/^image\//i.test(file.mimetype || '')) {
      return cb(new Error('Only image files (JPG, PNG, WEBP) can be uploaded as design references.'));
    }
    cb(null, true);
  },
});

// -------------------------------------------------------------- public API
app.get('/api/health', (req, res) => {
  res.json({ ok: true, emailConfigured: emailConfigured(), ownerEmail: OWNER_EMAIL, time: new Date().toISOString() });
});

app.get('/api/config', (req, res) => {
  res.json({ pricing: PRICING, ownerEmail: OWNER_EMAIL, emailConfigured: emailConfigured() });
});

app.get('/api/products', (req, res) => {
  res.json({ products: store.listProducts(), pricing: PRICING });
});

app.post('/api/uploads', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!throttle(`upload:${ip}`, 40, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many uploads. Please try again in a few minutes.' });
  }
  upload.array('images', 6)(req, res, (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Each image must be under 8 MB.' : err.message;
      return res.status(400).json({ error: message || 'Upload failed.' });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No images received.' });
    const saved = files.map((file) => {
      const record = {
        id: `up_${crypto.randomUUID()}`,
        file: path.basename(file.filename),
        originalName: file.originalname.slice(0, 120),
        mime: file.mimetype,
        size: file.size,
        createdAt: new Date().toISOString(),
      };
      store.addUpload(record);
      return { id: record.id, name: record.originalName, size: record.size };
    });
    res.status(201).json({ uploads: saved });
  });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAYMENTS = {
  cod: 'Cash on delivery',
  upi: 'UPI / bank transfer after confirmation',
};

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

app.post('/api/orders', async (req, res, next) => {
  try {
    const ip = req.ip || 'unknown';
    if (!throttle(`order:${ip}`, 12, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many orders from this connection. Please contact us on WhatsApp.' });
    }

    const body = req.body || {};
    const c = body.customer || {};
    const required = ['name', 'email', 'phone', 'address', 'city', 'country'];
    for (const field of required) {
      if (!c[field] || !String(c[field]).trim()) return badRequest(res, `Please provide your ${field}.`);
    }
    if (!EMAIL_RE.test(String(c.email).trim())) return badRequest(res, 'Please enter a valid email address.');
    const phone = String(c.phone).replace(/[^\d+]/g, '');
    if (phone.replace(/\D/g, '').length < 7) return badRequest(res, 'Please enter a valid phone number.');

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return badRequest(res, 'Your cart is empty.');
    if (items.length > 20) return badRequest(res, 'Please contact us for bulk orders above 20 jerseys.');

    const paymentMethod = PAYMENTS[body.paymentMethod] ? body.paymentMethod : 'cod';
    const builtItems = [];

    for (const rawItem of items) {
      const product = store.getProduct(String(rawItem.productId || ''));
      if (!product || !product.active) return badRequest(res, 'One of the jerseys in your cart is no longer available.');

      const variant = rawItem.variant === 'genuine' ? 'genuine' : 'fan';
      const basePrice = product.prices[variant];
      if (typeof basePrice !== 'number') {
        return badRequest(res, `${product.name} is not available in that version.`);
      }

      const size = String(rawItem.size || '').toUpperCase();
      if (!product.sizes.includes(size)) return badRequest(res, `Please choose a valid size for ${product.name}.`);

      const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
      const qty = Math.min(20, Math.max(1, Number.parseInt(rawItem.qty, 10) || 1));
      if (qty > stock) {
        return badRequest(res, `${product.name} only has ${stock} left in stock.`);
      }
      const printName = String(rawItem.printName || '').trim().slice(0, 16);
      if (printName && !/^[A-Za-z .'-]+$/.test(printName)) {
        return badRequest(res, 'Names can only contain letters, spaces, apostrophes and hyphens.');
      }
      const printNumberRaw = String(rawItem.printNumber || '').trim();
      if (printNumberRaw && !/^\d{1,2}$/.test(printNumberRaw)) {
        return badRequest(res, 'Jersey numbers must be 1 or 2 digits.');
      }

      const uploadIds = [];
      for (const uploadId of Array.isArray(rawItem.uploadIds) ? rawItem.uploadIds.slice(0, 6) : []) {
        const record = store.getUpload(String(uploadId));
        if (record) uploadIds.push({ id: record.id, record });
      }

      const customised = Boolean(printName || printNumberRaw);
      const customization = customised ? PRICING.customizationFee : 0;
      const unitPrice = basePrice + customization;

      builtItems.push({
        productId: product.id,
        productName: product.name,
        team: product.team,
        variant,
        variantLabel: variant === 'genuine' ? 'Original / genuine' : 'Fan-made look-alike',
        size,
        qty,
        printName,
        printNumber: printNumberRaw,
        notes: String(rawItem.notes || '').trim().slice(0, 800),
        uploadIds,
        unitPrice,
        customization,
        lineTotal: unitPrice * qty,
      });
    }

    const reservation = store.reserveStock(builtItems.map((i) => ({ productId: i.productId, qty: i.qty })));
    if (!reservation.ok) return badRequest(res, reservation.error);

    const subtotal = builtItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const shipping = subtotal >= PRICING.freeShippingOver ? 0 : PRICING.shippingFlat;

    const order = {
      id: `ord_${crypto.randomUUID()}`,
      code: `FR-${Date.now().toString(36).toUpperCase().slice(-5)}${crypto.randomInt(10, 99)}`,
      createdAt: new Date().toISOString(),
      status: 'new',
      customer: {
        name: String(c.name).trim().slice(0, 80),
        email: String(c.email).trim().slice(0, 120),
        phone: String(c.phone).trim().slice(0, 24),
        address: String(c.address).trim().slice(0, 300),
        city: String(c.city).trim().slice(0, 60),
        state: String(c.state || '').trim().slice(0, 60),
        pin: String(c.pin || '').trim().slice(0, 12),
        country: String(c.country).trim().slice(0, 60),
      },
      items: builtItems,
      subtotal,
      shipping,
      total: subtotal + shipping,
      notes: String(body.notes || '').trim().slice(0, 1000),
      paymentMethod,
      paymentLabel: PAYMENTS[paymentMethod],
      emailStatus: 'pending',
      emailDetail: '',
      history: [{ at: new Date().toISOString(), status: 'new', note: 'Order placed on the website' }],
    };

    store.addOrder(order);

    const emailResult = await sendOrderEmails(order);
    const updated = store.updateOrder(order.id, {
      emailStatus: emailResult.status,
      emailDetail: emailResult.detail || '',
      emailSentAt: emailResult.status === 'sent' ? new Date().toISOString() : null,
    });

    res.status(201).json({
      order: {
        id: updated.id,
        code: updated.code,
        total: updated.total,
        shipping: updated.shipping,
        subtotal: updated.subtotal,
        items: updated.items.map((i) => ({
          productName: i.productName,
          size: i.size,
          qty: i.qty,
          variantLabel: i.variantLabel,
          printName: i.printName,
          printNumber: i.printNumber,
          lineTotal: i.lineTotal,
        })),
        customer: { name: updated.customer.name, email: updated.customer.email },
      },
      email: { status: emailResult.status, ownerEmail: OWNER_EMAIL },
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- admin API
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!throttle(`login:${ip}`, 8, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 10 minutes.' });
  }
  const password = String((req.body || {}).password || '');
  const given = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!ok) return res.status(401).json({ error: 'Incorrect password.' });

  res.setHeader(
    'Set-Cookie',
    `fr_admin=${encodeURIComponent(signAdminToken())}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`
  );
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'fr_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: verifyAdminToken(readCookie(req, 'fr_admin')) });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({ stats: store.stats(), emailConfigured: emailConfigured(), ownerEmail: OWNER_EMAIL });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  res.json({ orders: store.getOrders({ status: req.query.status, q: req.query.q }) });
});

app.get('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json({ order });
});

app.patch('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const allowed = ['new', 'in_progress', 'ready', 'shipped', 'delivered', 'cancelled'];
  const status = String((req.body || {}).status || '');
  if (!allowed.includes(status)) return badRequest(res, 'Unknown order status.');
  const order = store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  order.status = status;
  order.history = order.history || [];
  order.history.push({
    at: new Date().toISOString(),
    status,
    note: String((req.body || {}).note || '').slice(0, 300),
  });
  store.updateOrder(order.id, order);
  res.json({ order });
});

app.post('/api/admin/orders/:id/resend', requireAdmin, async (req, res, next) => {
  try {
    const order = store.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const result = await sendOrderEmails(order);
    store.updateOrder(order.id, {
      emailStatus: result.status,
      emailDetail: result.detail || '',
      emailSentAt: result.status === 'sent' ? new Date().toISOString() : order.emailSentAt,
    });
    res.json({ email: result });
  } catch (err) {
    next(err);
  }
});

app.get('/api/admin/uploads/:id', requireAdmin, (req, res) => {
  const record = store.getUpload(req.params.id);
  if (!record) return res.status(404).json({ error: 'Image not found.' });
  const filePath = path.join(REFERENCE_DIR, path.basename(record.file));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Image file is missing on disk.' });
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(filePath);
});

app.get('/api/admin/products', requireAdmin, (req, res) => {
  res.json({ products: store.listProducts(true), pricing: PRICING });
});

app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  const patch = {};
  if (req.body && req.body.prices) patch.prices = req.body.prices;
  if (req.body && typeof req.body.active === 'boolean') patch.active = req.body.active;
  if (req.body && req.body.stock !== undefined) patch.stock = req.body.stock;
  const product = store.updateProduct(req.params.id, patch);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  res.json({ product });
});

// ------------------------------------------------------- SEO / crawler files
function siteUrl(req) {
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = req.get('host');
  return `${proto}://${host}`;
}

const INDEX_PATH = path.join(__dirname, 'public', 'index.html');

// Home page gets absolute URLs (canonical + Open Graph) filled in from the request host.
app.get(['/', '/index.html'], (req, res, next) => {
  fs.readFile(INDEX_PATH, 'utf8', (err, html) => {
    if (err) return next(err);
    res.type('html').send(html.replace(/__SITE_URL__/g, siteUrl(req)));
  });
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${siteUrl(req)}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const base = siteUrl(req);
  const today = new Date().toISOString().slice(0, 10);
  res.type('application/xml').send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `  <url>\n    <loc>${base}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>\n` +
      `</urlset>\n`
  );
});

// ------------------------------------------------------------------ static
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[server]', err);
  if (res.headersSent) return next(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Each image must be under 8 MB.' });
  }
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Fancy Raccoon store running at http://localhost:${PORT}`);
  console.log(`Orders are emailed to: ${OWNER_EMAIL}`);
  console.log(`SMTP: ${emailConfigured() ? 'configured' : 'not configured (orders still saved + visible in admin)'}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
});
