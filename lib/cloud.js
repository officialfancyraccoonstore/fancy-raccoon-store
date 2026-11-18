'use strict';
// Cloud mirror for orders + design reference images.
//
// Render's free plan gives the app a temporary disk: every restart or redeploy wipes
// data/db.json and the uploads folder. When DATABASE_URL (Neon Postgres) or
// MONGODB_URI (MongoDB Atlas) is set, everything important is copied to the cloud and
// loaded again on boot, so orders never disappear.
//
// DATABASE_URL wins when both are set: it is the one-paste setup.
const fs = require('fs');
const path = require('path');

const REFERENCE_DIR = path.join(__dirname, '..', 'uploads', 'reference');
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

let ready = false;
let backend = null; // 'postgres' | 'mongo'
let lastError = '';
let pgPool = null;
let mongoClient = null;
let ordersCol = null;
let uploadsCol = null;

function pgUrl() {
  return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || '').trim();
}

function mongoUri() {
  return String(process.env.MONGODB_URI || '').trim();
}

function provider() {
  if (pgUrl()) return 'postgres';
  if (mongoUri()) return 'mongo';
  return null;
}

function enabled() {
  return ready;
}

function label() {
  if (backend === 'postgres') return 'Neon Postgres (permanent)';
  if (backend === 'mongo') return 'MongoDB Atlas (permanent)';
  return '';
}

function status() {
  if (ready) return 'cloud';
  return provider() ? 'cloud-error' : 'local';
}

function detail() {
  if (lastError) return lastError;
  return ready ? label() : '';
}

function byNewest(a, b) {
  return String(b && b.createdAt ? b.createdAt : '').localeCompare(String(a && a.createdAt ? a.createdAt : ''));
}

function mergeById(remote, local) {
  const map = new Map();
  for (const item of Array.isArray(local) ? local : []) {
    if (item && item.id) map.set(item.id, item);
  }
  // Cloud copy wins: the local disk may be a fresh, empty container.
  for (const item of Array.isArray(remote) ? remote : []) {
    if (item && item.id) map.set(item.id, item);
  }
  return Array.from(map.values()).sort(byNewest);
}

async function readReference(record) {
  try {
    const filePath = path.join(REFERENCE_DIR, path.basename(String(record.file || '')));
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (stat && stat.size <= MAX_IMAGE_BYTES) return fs.promises.readFile(filePath);
  } catch (err) {
    /* missing file — nothing to back up */
  }
  return null;
}

// ------------------------------------------------------------------ Postgres
// One connection string in DATABASE_URL (Neon, Supabase, any Postgres). Tables are
// created on first boot, so there is nothing to set up in a dashboard.
function isLocalHost(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch (err) {
    return false;
  }
}

function cleanPgUrl(raw) {
  try {
    const url = new URL(raw);
    // pg handles TLS itself below; these params trip up older clients.
    url.searchParams.delete('channel_binding');
    url.searchParams.delete('sslmode');
    url.searchParams.delete('ssl');
    return url.toString();
  } catch (err) {
    return raw;
  }
}

const PG_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS orders (
     id text PRIMARY KEY,
     data jsonb NOT NULL,
     created_at text NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS uploads (
     id text PRIMARY KEY,
     data jsonb NOT NULL,
     bytes bytea,
     mime text,
     created_at text NOT NULL DEFAULT ''
   )`,
];

async function pgConnect() {
  let Pg;
  try {
    Pg = require('pg');
  } catch (err) {
    lastError = 'pg package is not installed';
    console.error('[cloud] pg package missing — orders stay on the local disk');
    return false;
  }
  const url = cleanPgUrl(pgUrl());
  pgPool = new Pg.Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 30000,
    ssl: isLocalHost(url) ? undefined : { rejectUnauthorized: false },
  });
  pgPool.on('error', (err) => {
    lastError = err.message;
    console.error(`[cloud] postgres connection error: ${err.message}`);
  });
  await pgPool.query('SELECT 1');
  for (const sql of PG_SCHEMA) await pgPool.query(sql);
  backend = 'postgres';
  ready = true;
  return true;
}

async function pgLoadAll() {
  const [orders, uploads] = await Promise.all([
    pgPool.query(`SELECT data FROM orders ORDER BY created_at DESC LIMIT 10000`),
    pgPool.query(`SELECT data FROM uploads ORDER BY created_at DESC LIMIT 5000`),
  ]);
  return {
    orders: orders.rows.map((row) => row.data),
    uploads: uploads.rows.map((row) => row.data),
  };
}

async function pgSaveOrder(doc) {
  await pgPool.query(
    `INSERT INTO orders (id, data, created_at) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
    [doc.id, JSON.stringify(doc), String(doc.createdAt || '')]
  );
}

async function pgSaveUpload(doc, buffer) {
  await pgPool.query(
    `INSERT INTO uploads (id, data, bytes, mime, created_at) VALUES ($1, $2::jsonb, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data,
       bytes = COALESCE(EXCLUDED.bytes, uploads.bytes),
       mime = COALESCE(EXCLUDED.mime, uploads.mime),
       created_at = EXCLUDED.created_at`,
    [doc.id, JSON.stringify(doc), buffer, doc.mime || null, String(doc.createdAt || '')]
  );
}

async function pgPushAll(orders, uploads) {
  const chunk = 80;
  for (let i = 0; i < orders.length; i += chunk) {
    const slice = orders.slice(i, i + chunk);
    const values = [];
    const params = [];
    slice.forEach((doc, idx) => {
      const base = idx * 3;
      values.push(`($${base + 1}, $${base + 2}::jsonb, $${base + 3})`);
      params.push(doc.id, JSON.stringify(doc), String(doc.createdAt || ''));
    });
    await pgPool.query(
      `INSERT INTO orders (id, data, created_at) VALUES ${values.join(', ')}
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
      params
    );
  }
  // Upload rows carry metadata; image bytes are pushed separately for files still on disk.
  for (const doc of uploads) await pgSaveUpload(doc, null);
}

async function pgGetUploadBuffer(id) {
  const result = await pgPool.query(`SELECT bytes FROM uploads WHERE id = $1`, [String(id)]);
  const row = result.rows[0];
  if (!row || !row.bytes) return null;
  return Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes);
}

// --------------------------------------------------------------------- Mongo
async function mongoConnect() {
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (err) {
    lastError = 'mongodb package is not installed';
    console.error('[cloud] mongodb package missing — orders stay on the local disk');
    return false;
  }
  mongoClient = new MongoClient(mongoUri(), {
    serverSelectionTimeoutMS: 9000,
    connectTimeoutMS: 9000,
    socketTimeoutMS: 20000,
  });
  await mongoClient.connect();
  const db = mongoClient.db(process.env.MONGODB_DB || 'fancyraccoon');
  ordersCol = db.collection('orders');
  uploadsCol = db.collection('uploads');
  await Promise.all([
    ordersCol.createIndex({ createdAt: -1 }).catch(() => {}),
    ordersCol.createIndex({ id: 1 }, { unique: true }).catch(() => {}),
    uploadsCol.createIndex({ id: 1 }, { unique: true }).catch(() => {}),
  ]);
  backend = 'mongo';
  ready = true;
  return true;
}

async function mongoLoadAll() {
  const [orders, uploads] = await Promise.all([
    ordersCol.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(10000).toArray(),
    uploadsCol.find({}, { projection: { _id: 0, data: 0 } }).sort({ createdAt: -1 }).limit(5000).toArray(),
  ]);
  return { orders, uploads };
}

async function mongoPushAll(orders, uploads) {
  if (orders.length) {
    const ops = orders.map((doc) => ({
      updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true },
    }));
    await ordersCol.bulkWrite(ops, { ordered: false });
  }
  if (uploads.length) {
    const ops = uploads.map((doc) => ({
      updateOne: { filter: { id: doc.id }, update: { $set: doc }, upsert: true },
    }));
    await uploadsCol.bulkWrite(ops, { ordered: false }).catch((err) => {
      console.error(`[cloud] upload metadata push failed: ${err.message}`);
    });
  }
}

async function mongoGetUploadBuffer(id) {
  const doc = await uploadsCol.findOne({ id: String(id) }, { projection: { data: 1 } });
  if (!doc || !doc.data) return null;
  return Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data.buffer || doc.data);
}

// ------------------------------------------------------------------- shared
// Called by the store after every write.
async function sync(entity, payload) {
  if (!ready || !payload || !payload.id) return;
  try {
    if (entity === 'order') {
      if (backend === 'postgres') await pgSaveOrder(payload);
      else await ordersCol.updateOne({ id: payload.id }, { $set: payload }, { upsert: true });
    } else if (entity === 'upload') {
      const buffer = await readReference(payload);
      if (backend === 'postgres') await pgSaveUpload(payload, buffer);
      else {
        const doc = { ...payload };
        if (buffer) doc.data = buffer;
        await uploadsCol.updateOne({ id: payload.id }, { $set: doc }, { upsert: true });
      }
    }
  } catch (err) {
    lastError = err.message;
    console.error(`[cloud] save failed: ${err.message}`);
  }
}

async function init(store) {
  const which = provider();
  if (!which) {
    console.log('[cloud] no cloud database configured — orders live on the local disk and reset on redeploy');
    return false;
  }

  try {
    const ok = which === 'postgres' ? await pgConnect() : await mongoConnect();
    if (!ok) return false;
  } catch (err) {
    lastError = err.message;
    ready = false;
    backend = null;
    console.error(`[cloud] could not connect to the cloud database: ${err.message}`);
    try {
      if (pgPool) await pgPool.end();
    } catch (closeErr) {
      /* ignore */
    }
    try {
      if (mongoClient) await mongoClient.close();
    } catch (closeErr) {
      /* ignore */
    }
    pgPool = null;
    mongoClient = null;
    return false;
  }

  try {
    const remote = backend === 'postgres' ? await pgLoadAll() : await mongoLoadAll();
    const mergedOrders = mergeById(remote.orders, store.getOrders());
    const mergedUploads = mergeById(remote.uploads, store.listUploads());
    store.replaceOrders(mergedOrders);
    store.replaceUploads(mergedUploads);

    // Push anything that only existed on this server's disk (e.g. orders taken before setup).
    if (backend === 'postgres') await pgPushAll(mergedOrders, mergedUploads);
    else await mongoPushAll(mergedOrders, mergedUploads);

    // Back up the actual image files that are still on this disk.
    const onDisk = mergedUploads.filter((u) => u && u.id);
    for (const record of onDisk) {
      const buffer = await readReference(record);
      if (!buffer) continue;
      if (backend === 'postgres') await pgSaveUpload(record, buffer);
      else await uploadsCol.updateOne({ id: record.id }, { $set: { data: buffer } }, { upsert: true });
    }

    console.log(`[cloud] connected to ${label()} — ${mergedOrders.length} order(s) restored`);
  } catch (err) {
    lastError = err.message;
    console.error(`[cloud] could not load saved orders: ${err.message}`);
  }

  store.setSyncHook(sync);
  return true;
}

async function getUploadBuffer(id) {
  if (!ready) return null;
  try {
    return backend === 'postgres' ? await pgGetUploadBuffer(id) : await mongoGetUploadBuffer(id);
  } catch (err) {
    lastError = err.message;
    return null;
  }
}

module.exports = { init, enabled, status, detail, label, getUploadBuffer };
