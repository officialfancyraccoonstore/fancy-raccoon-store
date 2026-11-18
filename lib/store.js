'use strict';
// Tiny durable JSON store. Writes are atomic (tmp file + rename) and serialised.
const fs = require('fs');
const path = require('path');
const { products: seedProducts } = require('./products');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = { products: [], orders: [], uploads: [], meta: { createdAt: new Date().toISOString() } };
let writeChain = Promise.resolve();
// Optional mirror (cloud storage) so orders survive a redeploy. Set by lib/cloud.js.
let syncHook = null;

function setSyncHook(fn) {
  syncHook = typeof fn === 'function' ? fn : null;
}

function mirror(entity, payload) {
  if (!syncHook) return;
  try {
    const result = syncHook(entity, payload);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (err) {
    console.error(`[store] cloud mirror for ${entity} failed: ${err.message}`);
  }
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(path.join(__dirname, '..', 'uploads'), { recursive: true });
}

function mergeProducts(stored, seeds) {
  const byId = new Map((stored || []).map((p) => [p.id, p]));
  // refresh from seed so catalogue/stock/prices can be updated centrally, but keep admin tweaks
  return seeds.map((seed) => {
    const existing = byId.get(seed.id);
    if (!existing) return { ...seed };
    const merged = { ...seed, ...existing };
    // always take current seed values for these core catalogue fields
    merged.name = seed.name;
    merged.team = seed.team;
    merged.category = seed.category;
    merged.kit = seed.kit;
    merged.pattern = seed.pattern;
    merged.colors = seed.colors;
    merged.sizes = seed.sizes;
    merged.blurb = seed.blurb;
    merged.badge = seed.badge;
    merged.position = seed.position;
    // stock: if existing is a valid number keep it (reflects orders), else seed default
    merged.stock = Number.isFinite(Number(existing.stock)) ? Math.max(0, Math.round(Number(existing.stock))) : seed.stock;
    if (merged.stock === 0 && seed.stock > 0 && (!existing.stock || existing.stock === seed.stock)) {
      // allow seed reset on fresh catalogue changes by keeping explicit 0 only if decremented via orders;
      // heuristic: keep existing numeric
      merged.stock = Math.max(0, Math.round(Number(existing.stock)));
    }
    // prices: prefer existing admin edits but ensure structure and genuine flag
    if (existing.prices && typeof existing.prices === 'object') {
      merged.prices = { ...seed.prices, ...existing.prices };
    } else {
      merged.prices = { ...seed.prices };
    }
    merged.genuine = typeof merged.prices.genuine === 'number';
    if (typeof existing.active !== 'boolean') merged.active = seed.active;
    return merged;
  });
}

function init() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (err) {
      const backup = `${DB_FILE}.corrupt-${Date.now()}`;
      fs.renameSync(DB_FILE, backup);
      console.error(`[store] db.json was unreadable (${err.message}); moved to ${backup}`);
    }
  }
  if (db.products && db.products.length) {
    // detect catalogue version bump: if seed ids differ materially, replace with fresh seed merged carefully
    const seedIds = seedProducts.map((p) => p.id).join(',');
    const storedIds = (db.products || []).map((p) => p.id).join(',');
    if (seedIds === storedIds) {
      db.products = mergeProducts(db.products, seedProducts);
    } else {
      // new catalogue definition wins; preserve per-id stock/prices/active where ids overlap
      db.products = mergeProducts(db.products, seedProducts);
    }
  } else {
    db.products = seedProducts.map((p) => ({ ...p }));
  }
  db.orders = db.orders || [];
  db.uploads = db.uploads || [];
  db.meta = db.meta || { createdAt: new Date().toISOString() };
  persist();
  return db;
}

function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        const tmp = `${DB_FILE}.${process.pid}.tmp`;
        fs.writeFile(tmp, snapshot, (err) => {
          if (err) return reject(err);
          fs.rename(tmp, DB_FILE, (renameErr) => (renameErr ? reject(renameErr) : resolve()));
        });
      })
  );
  return writeChain;
}

function listProducts(includeInactive = false) {
  return db.products
    .filter((p) => includeInactive || p.active)
    .slice()
    .sort((a, b) => a.position - b.position);
}

function getProduct(id) {
  return db.products.find((p) => p.id === id) || null;
}

function updateProduct(id, patch) {
  const product = getProduct(id);
  if (!product) return null;
  if (patch.prices && typeof patch.prices === 'object') {
    const next = { ...product.prices };
    for (const key of ['fan', 'genuine']) {
      if (patch.prices[key] === null) delete next[key];
      else if (Number.isFinite(Number(patch.prices[key]))) next[key] = Math.round(Number(patch.prices[key]));
    }
    product.prices = next;
    product.genuine = typeof next.genuine === 'number';
  }
  if (typeof patch.active === 'boolean') product.active = patch.active;
  if (Number.isFinite(Number(patch.stock))) product.stock = Math.max(0, Math.round(Number(patch.stock)));
  persist();
  return product;
}

function reserveStock(items) {
  // items: [{productId, qty}] - check and decrement atomically in this process
  for (const item of items) {
    const product = getProduct(item.productId);
    if (!product) return { ok: false, error: 'One of the jerseys in your cart is no longer available.' };
    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : 0;
    if (stock < item.qty) {
      return { ok: false, error: `${product.name} only has ${stock} left in stock.` };
    }
  }
  for (const item of items) {
    const product = getProduct(item.productId);
    product.stock = Math.max(0, (Number(product.stock) || 0) - item.qty);
  }
  return { ok: true };
}

function addOrder(order) {
  db.orders.unshift(order);
  persist();
  mirror('order', order);
  return order;
}

function getOrders({ status, q } = {}) {
  let list = db.orders.slice();
  if (status && status !== 'all') list = list.filter((o) => o.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((o) =>
      [o.code, o.customer?.name, o.customer?.email, o.customer?.phone, o.customer?.city]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle))
    );
  }
  return list;
}

function getOrder(id) {
  return db.orders.find((o) => o.id === id || o.code === id) || null;
}

function updateOrder(id, patch) {
  const order = getOrder(id);
  if (!order) return null;
  Object.assign(order, patch);
  persist();
  mirror('order', order);
  return order;
}

function addUpload(upload) {
  db.uploads.push(upload);
  persist();
  mirror('upload', upload);
  return upload;
}

function getUpload(id) {
  return db.uploads.find((u) => u.id === id) || null;
}

function stats() {
  const orders = db.orders;
  const live = orders.filter((o) => o.status !== 'cancelled');
  return {
    orders: orders.length,
    newOrders: orders.filter((o) => o.status === 'new').length,
    revenue: live.reduce((sum, o) => sum + (o.total || 0), 0),
    units: live.reduce((sum, o) => sum + (o.items || []).reduce((s, i) => s + i.qty, 0), 0),
    customers: new Set(orders.map((o) => o.customer?.email?.toLowerCase()).filter(Boolean)).size,
  };
}

function replaceOrders(list) {
  db.orders = Array.isArray(list) ? list.slice() : [];
  persist();
  return db.orders;
}

function replaceUploads(list) {
  db.uploads = Array.isArray(list) ? list.slice() : [];
  persist();
  return db.uploads;
}

function listUploads() {
  return db.uploads.slice();
}

module.exports = {
  init,
  setSyncHook,
  replaceOrders,
  replaceUploads,
  listUploads,
  listProducts,
  getProduct,
  updateProduct,
  reserveStock,
  addOrder,
  getOrders,
  getOrder,
  updateOrder,
  addUpload,
  getUpload,
  stats,
};
