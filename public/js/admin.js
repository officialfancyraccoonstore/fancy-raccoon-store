/* Fancy Raccoon studio dashboard */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
  const esc = (v) =>
    String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const STATUS_LABELS = {
    new: 'New',
    in_progress: 'In production',
    ready: 'Ready',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };

  const state = { orders: [], products: [], filter: 'all', q: '', stats: null, detail: null };

  function toast(message, kind = 'ok') {
    const el = $('#toast');
    el.textContent = message;
    el.className = `toast show${kind === 'err' ? ' err' : ''}`;
    setTimeout(() => {
      el.className = 'toast';
    }, 3000);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    });
    if (res.status === 401) {
      showLogin();
      throw new Error('Session expired. Please sign in again.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) throw new Error((data && data.error) || 'Request failed.');
    return data;
  }

  function showLogin() {
    $('#loginView').hidden = false;
    $('#dashView').hidden = true;
    $('#logoutBtn').hidden = true;
  }

  function showDash() {
    $('#loginView').hidden = true;
    $('#dashView').hidden = false;
    $('#logoutBtn').hidden = false;
  }

  /* -------------------------------------------------------------- login */
  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#loginSubmit');
    const error = $('#loginError');
    error.hidden = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: $('#loginPassword').value }),
      });
      $('#loginPassword').value = '';
      showDash();
      await loadAll();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try {
      await api('/api/admin/logout', { method: 'POST' });
    } catch (err) {
      /* ignore */
    }
    showLogin();
  });

  /* --------------------------------------------------------------- data */
  async function loadAll() {
    try {
      const [stats, orders, products] = await Promise.all([
        api('/api/admin/stats'),
        api('/api/admin/orders'),
        api('/api/admin/products'),
      ]);
      state.stats = stats;
      state.orders = orders.orders || [];
      state.products = products.products || [];
      renderStats(stats);
      renderOrders();
      renderProducts();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function loadOrders() {
    try {
      const query = state.q ? `?q=${encodeURIComponent(state.q)}` : '';
      const data = await api(`/api/admin/orders${query}`);
      state.orders = data.orders || [];
      renderOrders();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function renderStats(payload) {
    const s = payload.stats || {};
    $('#statGrid').innerHTML = `
      <div class="stat"><span>Total orders</span><strong>${s.orders || 0}</strong></div>
      <div class="stat"><span>Awaiting action</span><strong>${s.newOrders || 0}</strong></div>
      <div class="stat"><span>Revenue</span><strong>${money(s.revenue || 0)}</strong></div>
      <div class="stat"><span>Jerseys sold</span><strong>${s.units || 0}</strong></div>
      <div class="stat"><span>Customers</span><strong>${s.customers || 0}</strong></div>`;

    const configured = payload.emailConfigured;
    $('#emailStatus').className = `email-status ${configured ? 'ok' : 'warn'}`;
    $('#emailStatus').innerHTML = configured
      ? `✔ Orders emailing to ${esc(payload.ownerEmail)}`
      : `⚠ Email not connected — orders are saved here. Add SMTP_PASS to .env`;
  }

  function renderStatusFilters() {
    const statuses = ['all', 'new', 'in_progress', 'ready', 'shipped', 'delivered', 'cancelled'];
    $('#statusFilters').innerHTML = statuses
      .map(
        (status) =>
          `<button type="button" data-status="${status}" class="${state.filter === status ? 'is-active' : ''}">${
            status === 'all' ? 'All' : STATUS_LABELS[status]
          }</button>`
      )
      .join('');
  }

  function visibleOrders() {
    return state.orders.filter((order) => state.filter === 'all' || order.status === state.filter);
  }

  function renderOrders() {
    renderStatusFilters();
    const orders = visibleOrders();
    const list = $('#ordersList');
    if (!orders.length) {
      list.innerHTML = `<div class="empty-orders">No orders in this view yet. New custom orders will appear here instantly.</div>`;
      return;
    }
    list.innerHTML = orders
      .map((order) => {
        const units = (order.items || []).reduce((n, i) => n + i.qty, 0);
        const mailClass = order.emailStatus === 'sent' ? 'sent' : order.emailStatus === 'failed' ? 'failed' : 'pending';
        const mailLabel =
          order.emailStatus === 'sent'
            ? 'Emailed to studio'
            : order.emailStatus === 'failed'
            ? 'Email failed — resend'
            : order.emailStatus === 'not_configured'
            ? 'Email not set up'
            : 'Email pending';
        return `<div class="order-row" data-order="${esc(order.id)}">
          <div>
            <div class="order-code">${esc(order.code)}</div>
            <div class="order-date">${new Date(order.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
            <div class="order-mail ${mailClass}">${mailLabel}</div>
          </div>
          <div class="order-cust">
            <strong>${esc(order.customer.name)}</strong>
            <span>${esc(order.customer.city)}, ${esc(order.customer.country)}</span>
            <div class="order-mail">${esc(order.customer.phone)}</div>
          </div>
          <div class="order-total">${money(order.total)}<small>${units} jersey${units === 1 ? '' : 's'}</small></div>
          <div class="order-mail">${esc(order.paymentLabel || '')}</div>
          <span class="status-pill ${esc(order.status)}">${esc(STATUS_LABELS[order.status] || order.status)}</span>
        </div>`;
      })
      .join('');
  }

  function statusFilterHandler(event) {
    const btn = event.target.closest('[data-status]');
    if (!btn) return;
    state.filter = btn.dataset.status;
    renderOrders();
  }

  async function openOrder(id) {
    try {
      const data = await api(`/api/admin/orders/${encodeURIComponent(id)}`);
      state.detail = data.order;
      renderDetail();
      $('#orderModal').hidden = false;
      document.body.classList.add('locked');
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function renderDetail() {
    const order = state.detail;
    if (!order) return;
    const c = order.customer;
    const waNumber = String(c.phone || '').replace(/\D/g, '');

    const itemsHtml = (order.items || [])
      .map((item) => {
        const refs = (item.uploadIds || [])
          .map(
            (u) =>
              `<a href="/api/admin/uploads/${encodeURIComponent(u.id)}" target="_blank" rel="noopener"><img src="/api/admin/uploads/${encodeURIComponent(
                u.id
              )}" alt="${esc(u.record ? u.record.originalName : 'reference')}" loading="lazy"></a>`
          )
          .join('');
        return `<div class="detail-item">
          <div>
            <h5>${esc(item.productName)} ${item.variant === 'genuine' ? '<span style="color:var(--gold);font-size:11px">GENUINE</span>' : '<span style="color:var(--muted);font-size:11px">FAN-MADE</span>'}</h5>
            <div class="meta">Size ${esc(item.size)} · Qty ${item.qty} · ${money(item.unitPrice)} each</div>
            <div class="print">Print: ${esc(item.printName || '—')} ${esc(item.printNumber || '')}${
              item.customization ? ' · ₹99 customisation' : ''
            }</div>
            ${item.notes ? `<div class="brief">${esc(item.notes)}</div>` : ''}
            ${refs ? `<div class="ref-grid">${refs}</div>` : '<div class="meta" style="margin-top:8px;">No reference images.</div>'}
          </div>
          <div style="font-weight:700;font-size:13.5px;white-space:nowrap;">${money(item.lineTotal)}</div>
        </div>`;
      })
      .join('');

    const history = (order.history || [])
      .map(
        (entry) =>
          `<div><b>${esc(STATUS_LABELS[entry.status] || entry.status)}</b> · ${new Date(entry.at).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}${entry.note ? ` — ${esc(entry.note)}` : ''}</div>`
      )
      .join('');

    const mailBanner =
      order.emailStatus === 'sent'
        ? `<div class="mail-banner ok">✔ This order and ${(order.items || []).reduce((n, i) => n + (i.uploadIds || []).length, 0)} reference image(s) were emailed to the studio${
            order.emailSentAt ? ` on ${new Date(order.emailSentAt).toLocaleString('en-IN')}` : ''
          }.</div>`
        : order.emailStatus === 'failed'
        ? `<div class="mail-banner err">⚠ Email delivery failed${order.emailDetail ? `: ${esc(order.emailDetail)}` : ''}. The order is saved — use “Resend email”.</div>`
        : `<div class="mail-banner warn">⚠ Email is not connected yet. Add <strong>SMTP_USER</strong> and <strong>SMTP_PASS</strong> to the .env file, restart, then use “Resend email”.</div>`;

    $('#orderDetail').innerHTML = `
      <div class="detail-head">
        <p class="eyebrow">${esc(STATUS_LABELS[order.status] || order.status)} · ${new Date(order.createdAt).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}</p>
        <h2>${esc(order.code)}</h2>
        <p>${esc(order.paymentLabel || '')} · ${money(order.total)}</p>
      </div>
      ${mailBanner}
      <div class="detail-grid">
        <div class="detail-card">
          <h4>Customer</h4>
          <p><strong>${esc(c.name)}</strong><br>${esc(c.email)}<br>${esc(c.phone)}</p>
          <p style="margin-top:8px;color:var(--muted);font-size:11.5px;">Ship to</p>
          <p>${esc(c.address)}<br>${esc(c.city)}${c.state ? `, ${esc(c.state)}` : ''} ${esc(c.pin || '')}<br>${esc(c.country)}</p>
          <p style="margin-top:8px;"><a href="mailto:${esc(c.email)}?subject=Your%20Fancy%20Raccoon%20order%20${encodeURIComponent(
            order.code
          )}">Email customer</a> · <a href="https://wa.me/${esc(waNumber)}" target="_blank" rel="noopener">WhatsApp</a></p>
        </div>
        <div class="detail-card">
          <h4>Update status</h4>
          <div class="status-actions">
            ${['new', 'in_progress', 'ready', 'shipped', 'delivered', 'cancelled']
              .map(
                (status) =>
                  `<button type="button" data-set-status="${status}" class="${order.status === status ? 'is-active' : ''}">${
                    STATUS_LABELS[status]
                  }</button>`
              )
              .join('')}
          </div>
          <div class="history">${history}</div>
        </div>
      </div>

      <div class="detail-items">${itemsHtml}</div>

      ${
        order.notes
          ? `<div class="detail-card" style="margin-top:16px;"><h4>Order notes</h4><p>${esc(order.notes)}</p></div>`
          : ''
      }

      <div style="margin-top:18px;">
        <div class="detail-total"><span>Subtotal</span><span>${money(order.subtotal)}</span></div>
        <div class="detail-total"><span>Shipping</span><span>${order.shipping ? money(order.shipping) : 'FREE'}</span></div>
        <div class="detail-total grand"><span>Total</span><span>${money(order.total)}</span></div>
      </div>

      <div class="admin-actions">
        <button class="btn btn-ghost" type="button" id="resendBtn">Resend order email</button>
        <a class="btn btn-primary" href="https://wa.me/${esc(waNumber)}?text=${encodeURIComponent(
          `Hi ${c.name}, your Fancy Raccoon order ${order.code} is confirmed. Here is your print proof:`
        )}" target="_blank" rel="noopener">Message customer</a>
      </div>`;

    $('#orderDetail')
      .querySelectorAll('[data-set-status]')
      .forEach((btn) => btn.addEventListener('click', () => setStatus(btn.dataset.setStatus)));
    const resend = $('#resendBtn');
    if (resend) resend.addEventListener('click', resendEmail);
  }

  async function setStatus(status) {
    if (!state.detail) return;
    try {
      const data = await api(`/api/admin/orders/${encodeURIComponent(state.detail.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      state.detail = data.order;
      const index = state.orders.findIndex((o) => o.id === data.order.id);
      if (index >= 0) state.orders[index] = data.order;
      renderDetail();
      renderOrders();
      toast(`Order marked ${STATUS_LABELS[status] || status}.`);
      loadAll();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  async function resendEmail() {
    if (!state.detail) return;
    const button = $('#resendBtn');
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const data = await api(`/api/admin/orders/${encodeURIComponent(state.detail.id)}/resend`, { method: 'POST' });
      if (data.email.status === 'sent') {
        toast('Order email sent to the studio.');
      } else if (data.email.status === 'not_configured') {
        toast('Email is not configured yet — add SMTP_PASS to .env.', 'err');
      } else {
        toast(`Email failed: ${data.email.detail || 'unknown error'}`, 'err');
      }
      const fresh = await api(`/api/admin/orders/${encodeURIComponent(state.detail.id)}`);
      state.detail = fresh.order;
      renderDetail();
      renderOrders();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      const btn = $('#resendBtn');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Resend order email';
      }
    }
  }

  /* ----------------------------------------------------------- products */
  function renderProducts() {
    if (!state.products.length) {
      $('#productsList').innerHTML = '<div class="empty-orders">No products found.</div>';
      return;
    }
    $('#productsList').innerHTML = state.products
      .map(
        (product) => `<div class="prod-row" data-product-row="${esc(product.id)}">
          <div>
            <strong>${esc(product.name)}</strong>
            <small>${esc(product.team)} · ${product.category === 'club' ? 'Club' : 'National'} · ${Number(product.stock || 0)} in stock</small>
          </div>
          <label style="font-size:10.5px;color:var(--muted);">Fan ₹
            <input type="number" min="0" step="10" value="${product.prices.fan || ''}" data-price="fan">
          </label>
          <label style="font-size:10.5px;color:var(--muted);">Original ₹
            <input type="number" min="0" step="10" value="${product.prices.genuine || ''}" placeholder="not sold" data-price="genuine">
          </label>
          <label style="font-size:10.5px;color:var(--muted);">Stock
            <input type="number" min="0" step="1" value="${Number.isFinite(Number(product.stock)) ? Number(product.stock) : 10}" data-stock>
          </label>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
            <label class="prod-toggle"><input type="checkbox" data-active ${product.active ? 'checked' : ''}> Listed</label>
            <button class="prod-save" type="button" data-save-product="${esc(product.id)}">Save</button>
          </div>
        </div>`
      )
      .join('');

    $$('[data-save-product]').forEach((btn) => btn.addEventListener('click', () => saveProduct(btn.dataset.saveProduct)));
  }

  async function saveProduct(id) {
    const row = $(`[data-product-row="${id}"]`);
    if (!row) return;
    const fanInput = row.querySelector('[data-price="fan"]');
    const genuineInput = row.querySelector('[data-price="genuine"]');
    const stockInput = row.querySelector('[data-stock]');
    const activeInput = row.querySelector('[data-active]');
    const prices = {};
    if (fanInput.value) prices.fan = Number(fanInput.value);
    prices.genuine = genuineInput.value ? Number(genuineInput.value) : null;
    try {
      await api(`/api/admin/products/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ prices, active: activeInput.checked, stock: stockInput ? Number(stockInput.value) : undefined }),
      });
      toast('Product updated.');
      const data = await api('/api/admin/products');
      state.products = data.products || [];
      renderProducts();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  /* --------------------------------------------------------------- wire */
  $('#orderModalClose').addEventListener('click', () => {
    $('#orderModal').hidden = true;
    document.body.classList.remove('locked');
  });
  $('#orderModal').addEventListener('click', (event) => {
    if (event.target.id === 'orderModal') {
      $('#orderModal').hidden = true;
      document.body.classList.remove('locked');
    }
  });

  $('#ordersList').addEventListener('click', (event) => {
    const row = event.target.closest('[data-order]');
    if (row) openOrder(row.dataset.order);
  });

  $('#statusFilters').addEventListener('click', statusFilterHandler);

  $('#orderSearch').addEventListener('input', (event) => {
    state.q = event.target.value.trim();
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(loadOrders, 220);
  });

  $('#refreshBtn').addEventListener('click', () => {
    loadAll();
    toast('Refreshed.');
  });

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $('#ordersPanel').hidden = tab.dataset.tab !== 'orders';
      $('#productsPanel').hidden = tab.dataset.tab !== 'products';
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#orderModal').hidden) {
      $('#orderModal').hidden = true;
      document.body.classList.remove('locked');
    }
  });

  async function boot() {
    try {
      const session = await api('/api/admin/session');
      if (session.authenticated) {
        showDash();
        await loadAll();
      } else {
        showLogin();
      }
    } catch (err) {
      showLogin();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
