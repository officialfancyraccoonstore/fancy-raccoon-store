'use strict';
// Order notifications to a phone instead of (or as well as) email.
// Telegram is the primary channel: free, instant, works from any host over HTTPS,
// and it can carry the customer's reference photos. CallMeBot WhatsApp is optional.
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'reference');
const BRAND = 'Fancy Raccoon';

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return token && chat ? { token, chat } : null;
}

function whatsappConfig() {
  const phone = process.env.CALLMEBOT_PHONE;
  const key = process.env.CALLMEBOT_APIKEY;
  return phone && key ? { phone, key } : null;
}

function notificationsConfigured() {
  return Boolean(telegramConfig() || whatsappConfig());
}

function money(n) {
  return `₹${Number(n || 0).toLocaleString('en-IN')}`;
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function orderText(order) {
  const c = order.customer;
  const items = order.items
    .map((i) => {
      const bits = [
        `• ${i.productName}`,
        `  ${i.variantLabel} · Size ${i.size} · Qty ${i.qty}`,
        i.printName || i.printNumber ? `  Print: ${[i.printName, i.printNumber].filter(Boolean).join(' / ')}` : '',
        i.notes ? `  Design: ${i.notes}` : '',
        (i.uploadIds || []).length ? `  ${i.uploadIds.length} reference photo(s)` : '',
        `  ${money(i.lineTotal)}`,
      ];
      return bits.filter(Boolean).join('\n');
    })
    .join('\n\n');

  return [
    `<b>🦝 NEW ORDER ${esc(order.code)}</b>`,
    `${money(order.total)} · ${esc(order.paymentLabel || '')}`,
    '',
    `<b>${esc(c.name)}</b>`,
    `📞 ${esc(c.phone)}`,
    c.email ? `✉️ ${esc(c.email)}` : '',
    `${esc(c.address)}, ${esc(c.city)}, ${esc(c.state)} ${esc(c.pin)}`,
    `${esc(c.country)}`,
    '',
    items,
    order.notes ? `\nNote: ${esc(order.notes)}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .slice(0, 3800);
}

async function sendTelegramText(cfg, text) {
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: cfg.chat,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.description) detail = `${detail}: ${body.description}`;
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }
}

async function sendTelegramPhoto(cfg, order, upload) {
  const filePath = path.join(UPLOAD_DIR, upload.file);
  if (!fs.existsSync(filePath)) return false;
  const form = new FormData();
  form.append('chat_id', cfg.chat);
  form.append('caption', `${order.code} · ${upload.originalName}`.slice(0, 900));
  form.append(
    'document',
    new Blob([fs.readFileSync(filePath)], { type: upload.mime || 'application/octet-stream' }),
    upload.originalName || 'reference.jpg'
  );
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendDocument`, {
    method: 'POST',
    body: form,
  });
  return res.ok;
}

function referencesToSend(order, limit = 6) {
  const uploads = [];
  for (const item of order.items) {
    for (const ref of item.uploadIds || []) {
      if (ref && ref.record) uploads.push(ref.record);
    }
  }
  return uploads.slice(0, limit);
}

async function sendWhatsapp(order) {
  const cfg = whatsappConfig();
  const text = `NEW ORDER ${order.code} — ${money(order.total)}\n${order.customer.name} · ${order.customer.phone}\n${order.customer.address}, ${order.customer.city} ${order.customer.pin}, ${order.customer.country}\n\n${order.items
    .map((i) => `${i.productName} · ${i.variantLabel} · ${i.size} × ${i.qty}${i.notes ? ` · ${i.notes}` : ''}`)
    .join('\n')}`;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(cfg.phone)}&text=${encodeURIComponent(
    text
  )}&apikey=${encodeURIComponent(cfg.key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function notifyOrder(order) {
  const tg = telegramConfig();
  const wa = whatsappConfig();
  if (!tg && !wa) {
    return { status: 'not_configured' };
  }

  const results = [];
  let firstError = '';

  if (tg) {
    try {
      await sendTelegramText(tg, orderText(order));
      let photos = 0;
      for (const upload of referencesToSend(order)) {
        try {
          if (await sendTelegramPhoto(tg, order, upload)) photos += 1;
        } catch (err) {
          console.warn(`[notify] telegram photo failed: ${err.message}`);
        }
      }
      results.push(`telegram:${photos > 0 ? `sent+${photos}photos` : 'sent'}`);
    } catch (err) {
      console.error(`[notify] telegram failed for ${order.code}: ${err.message}`);
      firstError = firstError || `Telegram: ${err.message}`;
      results.push('telegram:failed');
    }
  }

  if (wa) {
    try {
      await sendWhatsapp(order);
      results.push('whatsapp:sent');
    } catch (err) {
      console.error(`[notify] whatsapp failed for ${order.code}: ${err.message}`);
      firstError = firstError || `WhatsApp: ${err.message}`;
      results.push('whatsapp:failed');
    }
  }

  const sent = results.some((r) => !r.endsWith('failed'));
  return {
    status: sent ? 'sent' : 'failed',
    detail: firstError || '',
    channels: results.join(', '),
  };
}

module.exports = { notifyOrder, notificationsConfigured };
