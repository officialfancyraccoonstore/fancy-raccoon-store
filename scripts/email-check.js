'use strict';
/* End-to-end check of the email pipeline against a throwaway local SMTP server.
   Proves: order -> composed HTML mail -> attached reference image -> studio inbox.
   Run: node scripts/email-check.js  (from the app folder) */
const { SMTPServer } = require('smtp-server');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3110;
const SMTP_PORT = 2526;
const captured = [];
let failures = 0;

function check(label, condition, extra) {
  if (condition) {
    console.log(`PASS  ${label}${extra ? ` — ${extra}` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

const smtp = new SMTPServer({
  authOptional: true,
  hideSTARTTLS: true,
  onAuth(auth, session, callback) {
    if (auth.username && auth.password) return callback(null, { user: auth.username });
    callback(new Error('credentials required'));
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      // undo quoted-printable soft line breaks so plain-text assertions survive wrapping
      const plain = raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
      const header = (name) => (raw.match(new RegExp(`^${name}: (.*)$`, 'm')) || [])[1] || '';
      captured.push({
        to: session.envelope.rcptTo.map((r) => r.address),
        from: session.envelope.mailFrom.address,
        subject: header('Subject'),
        attachmentCount: (raw.match(/Content-Disposition: attachment/g) || []).length,
        bytes: raw.length,
        hasCustomerName: plain.includes('Rohit Sharma'),
        hasBrief: plain.includes('bigger crest'),
        hasAttachmentName: plain.includes('my-design.png'),
      });
      callback();
    });
  },
});

const smtpReady = new Promise((resolve) => smtp.listen(SMTP_PORT, '127.0.0.1', resolve));

smtpReady.then(() => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(SMTP_PORT),
      SMTP_USER: 'studio@fancyraccoon.test',
      SMTP_PASS: 'test-password',
      OWNER_EMAIL: 'officialfancyraccoon.store@gmail.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logs = [];
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));

  const waitForServer = async () => {
    for (let i = 0; i < 50; i += 1) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (res.ok) return true;
      } catch (err) {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  };

  (async () => {
    const up = await waitForServer();
    check('store boots with SMTP settings', up);
    if (!up) throw new Error('server did not start');

    const health = await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json();
    check('health reports email configured', health.emailConfigured === true);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
      'base64'
    );
    const form = new FormData();
    form.append('images', new Blob([png], { type: 'image/png' }), 'my-design.png');
    const uploadRes = await fetch(`http://127.0.0.1:${PORT}/api/uploads`, { method: 'POST', body: form });
    const upload = await uploadRes.json();
    check('reference image uploads', uploadRes.status === 201 && upload.uploads.length === 1, upload.uploads?.[0]?.name);

    const orderRes = await fetch(`http://127.0.0.1:${PORT}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: {
          name: 'Rohit Sharma',
          email: 'rohit@example.com',
          phone: '9876543210',
          address: '14 Bahadur Shah Zafar Marg',
          city: 'New Delhi',
          state: 'Delhi',
          pin: '110002',
          country: 'India',
        },
        items: [
          {
            productId: 'india-home',
            variant: 'fan',
            size: 'L',
            qty: 1,
            printName: 'SHARMA',
            printNumber: '7',
            notes: 'Slightly bigger crest, saffron trim.',
            uploadIds: [upload.uploads[0].id],
          },
        ],
        paymentMethod: 'cod',
      }),
    });
    const order = await orderRes.json();
    check('order accepted', orderRes.status === 201, order.order?.code);
    check('order email reported sent', order.email?.status === 'sent', JSON.stringify(order.email));

    await new Promise((r) => setTimeout(r, 700));

    const studio = captured.find((m) => m.to.includes('officialfancyraccoon.store@gmail.com'));
    const customer = captured.find((m) => m.to.includes('rohit@example.com'));
    check('studio inbox received the order email', Boolean(studio), studio ? `${studio.bytes} bytes` : 'none');
    check('studio email subject names the order', Boolean(studio && studio.subject.includes(order.order.code)), studio?.subject);
    check(
      'reference image attached to studio email',
      Boolean(studio && studio.attachmentCount >= 1 && studio.hasAttachmentName),
      `${studio?.attachmentCount} attachment(s), named: ${studio?.hasAttachmentName}`
    );
    check('customer details inside the email', Boolean(studio && studio.hasCustomerName && studio.hasBrief));
    check('customer confirmation email sent', Boolean(customer), customer?.subject);

    console.log('\n--- captured mail ---');
    captured.forEach((m) => console.log(JSON.stringify(m)));

    if (!orderRes.ok || order.email?.status !== 'sent') console.log('\nserver log:\n' + logs.join(''));
  })()
    .catch((err) => {
      failures += 1;
      console.error('ERROR', err.message);
      console.log('server log:\n' + logs.join(''));
    })
    .finally(() => {
      child.kill();
      smtp.close();
      setTimeout(() => {
        console.log(failures === 0 ? '\nEMAIL PIPELINE OK' : `\nEMAIL PIPELINE FAILURES: ${failures}`);
        process.exit(failures === 0 ? 0 : 1);
      }, 200);
    });
});
