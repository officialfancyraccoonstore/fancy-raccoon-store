'use strict';
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'officialfancyraccoon.store@gmail.com';
const BRAND = 'Fancy Raccoon';
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'reference');

let transporter = null;
let transportReason = 'Email is not configured yet (add BREVO_API_KEY, or SMTP_USER + SMTP_PASS).';

// HTTP email delivery (Brevo). Needed on hosts that block outbound SMTP ports,
// which includes Render's free web services (ports 25, 465 and 587 are blocked there).
function apiConfig() {
  const key = process.env.BREVO_API_KEY;
  if (!key) return null;
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || OWNER_EMAIL;
  return { key, from, fromName: process.env.MAIL_FROM_NAME || BRAND };
}

async function sendViaHttp({ to, replyTo, subject, html, attachments }) {
  const cfg = apiConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const payload = {
      sender: { email: cfg.from, name: cfg.fromName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      attachment: (attachments || []).map((a) => ({
        name: a.filename,
        content: fs.readFileSync(a.path).toString('base64'),
      })),
    };
    if (replyTo) payload.replyTo = { email: replyTo };

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': cfg.key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && body.message) detail = `${detail}: ${body.message}`;
      } catch (_) {
        /* non-JSON error body */
      }
      throw new Error(detail);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  transportReason = '';
  return transporter;
}

function money(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attachmentsFor(order) {
  const files = [];
  for (const item of order.items) {
    for (const uploadId of item.uploadIds || []) {
      const upload = uploadId.record;
      if (!upload) continue;
      const filePath = path.join(UPLOAD_DIR, upload.file);
      if (fs.existsSync(filePath)) {
        files.push({
          filename: `${order.code}-${upload.originalName}`.replace(/[^\w.\-]+/g, '_'),
          path: filePath,
          contentType: upload.mime,
        });
      }
    }
  }
  return files;
}

function adminHtml(order) {
  const rows = order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #ececec;">
          <strong>${escapeHtml(item.name)}</strong><br>
          <span style="color:#666;font-size:12px;">${escapeHtml(item.productName)} · Size ${escapeHtml(
        item.size
      )} · Qty ${item.qty}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #ececec;font-family:monospace;">
          ${escapeHtml(item.printName || '—')} / ${escapeHtml(item.printNumber || '—')}
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #ececec;text-align:right;white-space:nowrap;">${money(
          item.lineTotal
        )}</td>
      </tr>`
    )
    .join('');

  const designs = order.items
    .filter((i) => i.notes || (i.uploadIds || []).length)
    .map(
      (i) => `<li style="margin-bottom:8px;"><strong>${escapeHtml(i.productName)}</strong>${
        i.notes ? `<br><span style="color:#444;">${escapeHtml(i.notes)}</span>` : ''
      }${
        (i.uploadIds || []).length
          ? `<br><span style="color:#666;font-size:12px;">${i.uploadIds.length} reference image(s) attached to this email.</span>`
          : ''
      }</li>`
    )
    .join('');

  const c = order.customer;
  return `
  <div style="background:#f5f6f8;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e6e6e6;">
      <div style="background:#0b0c10;color:#fff;padding:22px 24px;">
        <div style="font-size:12px;letter-spacing:2px;color:#c8ff4d;">FANCY RACCOON · NEW CUSTOM ORDER</div>
        <div style="font-size:26px;font-weight:700;margin-top:6px;">${escapeHtml(order.code)}</div>
        <div style="font-size:13px;color:#b9bcc4;margin-top:4px;">Placed ${new Date(order.createdAt).toLocaleString(
          'en-IN',
          { timeZone: 'Asia/Kolkata' }
        )} IST</div>
      </div>
      <div style="padding:24px;">
        <h3 style="margin:0 0 10px;font-size:16px;">Customer</h3>
        <p style="margin:0 0 4px;font-size:14px;line-height:1.6;">
          <strong>${escapeHtml(c.name)}</strong><br>
          ${escapeHtml(c.email)}<br>
          ${escapeHtml(c.phone)}<br>
          ${escapeHtml(c.address)}<br>
          ${escapeHtml(c.city)}, ${escapeHtml(c.state)} ${escapeHtml(c.pin)}<br>
          ${escapeHtml(c.country)}
        </p>
        <p style="margin:10px 0 18px;font-size:13px;color:#444;">
          Payment: <strong>${escapeHtml(order.paymentLabel)}</strong>
        </p>

        <h3 style="margin:0 0 10px;font-size:16px;">Jerseys</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:16px;">
          <tr><td style="padding:4px 0;color:#555;">Subtotal (incl. customisation)</td><td style="text-align:right;">${money(
            order.subtotal
          )}</td></tr>
          <tr><td style="padding:4px 0;color:#555;">Shipping</td><td style="text-align:right;">${
            order.shipping ? money(order.shipping) : 'FREE'
          }</td></tr>
          <tr><td style="padding:10px 0 0;font-weight:700;border-top:1px solid #e6e6e6;">Total</td><td style="padding:10px 0 0;text-align:right;font-weight:700;">${money(
            order.total
          )}</td></tr>
        </table>

        ${
          designs
            ? `<h3 style="margin:22px 0 8px;font-size:16px;">Design brief & references</h3>
               <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;">${designs}</ul>`
            : ''
        }

        ${
          order.notes
            ? `<h3 style="margin:22px 0 8px;font-size:16px;">Order notes</h3>
               <p style="margin:0;font-size:13px;color:#333;">${escapeHtml(order.notes)}</p>`
            : ''
        }

        <p style="margin:24px 0 0;font-size:12px;color:#777;">
          Reply to this email to reach the customer, or open the admin dashboard to update the order status.
        </p>
      </div>
    </div>
  </div>`;
}

function customerHtml(order) {
  const lines = order.items
    .map(
      (i) =>
        `<tr><td style="padding:8px 0;">${escapeHtml(i.productName)} <span style="color:#777;">· ${
          i.size
        } · ${escapeHtml(i.printName || 'no name')} ${escapeHtml(i.printNumber || '')}</span></td><td style="text-align:right;">${money(
          i.lineTotal
        )}</td></tr>`
    )
    .join('');
  return `
  <div style="background:#f5f6f8;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;padding:26px;border:1px solid #e6e6e6;">
      <div style="font-size:12px;letter-spacing:2px;color:#0f7a3d;">ORDER CONFIRMED</div>
      <h2 style="margin:8px 0 6px;font-size:24px;">Thanks, ${escapeHtml(order.customer.name.split(' ')[0])}!</h2>
      <p style="font-size:14px;color:#444;line-height:1.6;margin:0 0 16px;">
        We've received your custom jersey order <strong>${escapeHtml(order.code)}</strong>.
        Our team reviews every design brief by hand and will confirm your print proof on WhatsApp within 24 hours.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${lines}
        <tr><td style="padding:8px 0;border-top:1px solid #eee;">Shipping</td><td style="text-align:right;border-top:1px solid #eee;">${
          order.shipping ? money(order.shipping) : 'FREE'
        }</td></tr>
        <tr><td style="padding:10px 0 0;font-weight:700;">Total</td><td style="text-align:right;font-weight:700;">${money(
          order.total
        )}</td></tr>
      </table>
      <p style="font-size:13px;color:#444;margin:18px 0 0;">Delivery to: ${escapeHtml(order.customer.address)}, ${escapeHtml(
    order.customer.city
  )}, ${escapeHtml(order.customer.country)}</p>
      <p style="font-size:12px;color:#888;margin:18px 0 0;">Fancy Raccoon · officialfancyraccoon.store@gmail.com</p>
    </div>
  </div>`;
}

async function deliver({ to, replyTo, subject, html, attachments }) {
  if (apiConfig()) {
    await sendViaHttp({ to, replyTo, subject, html, attachments });
    return 'http';
  }
  const tx = getTransporter();
  if (!tx) throw new Error(transportReason);
  // Sender address must be the verified one; SMTP_USER can be a relay login that is not an email.
  const fromAddress = process.env.MAIL_FROM || process.env.SMTP_USER || OWNER_EMAIL;
  await tx.sendMail({
    from: `"${BRAND}" <${fromAddress}>`,
    to,
    replyTo,
    subject,
    html,
    attachments,
  });
  return 'smtp';
}

async function sendOrderEmails(order) {
  if (!emailConfigured()) {
    console.warn(`[email] ${transportReason} Order ${order.code} saved; email queued as not_configured.`);
    return { status: 'not_configured', detail: transportReason };
  }

  const attachments = attachmentsFor(order);
  try {
    const channel = await deliver({
      to: OWNER_EMAIL,
      replyTo: order.customer.email,
      subject: `New custom order ${order.code} · ${order.customer.name} · ${money(order.total)}`,
      html: adminHtml(order),
      attachments,
    });

    let customerStatus = 'skipped';
    try {
      await deliver({
        to: order.customer.email,
        subject: `Your Fancy Raccoon order ${order.code} is confirmed`,
        html: customerHtml(order),
        attachments: [],
      });
      customerStatus = 'sent';
    } catch (err) {
      console.warn(`[email] customer confirmation failed for ${order.code}: ${err.message}`);
      customerStatus = 'failed';
    }

    return { status: 'sent', customerStatus, attachments: attachments.length, to: OWNER_EMAIL, channel };
  } catch (err) {
    console.error(`[email] admin notification failed for ${order.code}: ${err.message}`);
    return { status: 'failed', detail: err.message };
  }
}

function emailConfigured() {
  return Boolean(apiConfig() || getTransporter());
}

module.exports = { sendOrderEmails, emailConfigured, OWNER_EMAIL };
