# Fancy Raccoon — custom football jersey store

A complete, working e-commerce site for custom football jerseys (India & Nepal):
European clubs + national teams, fan-made jerseys from ₹499, genuine authorised
merchandise, a live customiser (size, name, number, design brief, reference image
uploads), cart, checkout, and a password-protected admin dashboard.

Every order is emailed to **officialfancyraccoon.store@gmail.com** with the full
customer detail and all uploaded reference images attached.

## Run it

```bash
cd app
npm install
cp .env.example .env      # then fill in SMTP_PASS etc.
npm start                 # http://localhost:3000
```

## Turn on real email delivery

1. On the Google account for **officialfancyraccoon.store@gmail.com** turn on 2-Step Verification.
2. Google Account → Security → **App passwords** → create one for "Mail".
3. Put the 16-character password in `.env` as `SMTP_PASS` (no spaces).
4. Restart with `npm start`.

Until SMTP is configured, orders are still saved in full (customer, jerseys,
design briefs, uploaded images) and appear in the admin dashboard with an email
status of `not_configured`, so nothing is ever lost.

## Admin dashboard

- URL: `/admin`
- Password: `ADMIN_PASSWORD` from `.env` (default `fancyraccoon2026` — change it).

The dashboard shows stats, every order with full customer detail, the design
brief, downloadable reference images, status updates (new → in progress → ready →
shipped → delivered), a resend-email button, and price/availability editing for
each jersey.

## How the order flow works

1. Customer picks a jersey, then chooses **fan-made** or **genuine authorised**.
2. They pick a size, add a name and number (₹99 print fee), describe the design,
   and upload up to 6 reference photos.
3. Images upload immediately (`POST /api/uploads`) and the cart keeps their ids, so
   nothing is lost on a page refresh.
4. Checkout saves the order (`POST /api/orders`), recalculates every price on the
   server, emails the brand inbox with attachments, and sends the customer a
   confirmation email.
5. Shipping is ₹79, free over ₹1,499. Customisation is ₹99 per printed jersey.

## Verifying email without real credentials

`scripts/email-check.js` boots the store against a throwaway local SMTP server and asserts that the
studio email arrives with the customer details, the design brief and the reference image attached.
It needs one extra dev-only package that is not part of the site:

```bash
npm install --no-save smtp-server
node scripts/email-check.js
```

## Project layout

```
app/
  server.js          API, pricing, auth, uploads, order handling
  lib/products.js    the catalogue (5 European clubs + national teams)
  lib/store.js       atomic JSON persistence (data/db.json)
  lib/email.js       Gmail SMTP order + customer emails with attachments
  public/            index.html, admin.html, css, js
  uploads/reference/ customer reference images (never publicly served)
  data/db.json       orders, uploads, products (created on first run)
```

Reference images are **not** public: they are only served to a logged-in admin
through `/api/admin/uploads/:id`.
