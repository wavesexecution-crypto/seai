/* SEAI auth client — shared helpers for auth flows */
'use strict';

// API helper — returns parsed JSON or throws with server message
async function api(path, body) {
  const r = await fetch('/api/auth' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await r.json(); } catch { /* ignore */ }
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Password strength scoring (0-4)
// Returns { score, label, met: { length, upper, lower, number, symbol } }
function scorePassword(pw) {
  const met = {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  const passed = Object.values(met).filter(Boolean).length;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12 && passed >= 3) score++;
  if (passed >= 4) score++;
  if (passed >= 5 && pw.length >= 12) score++;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score], met };
}

// Email validation
function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
}

// Toggle password visibility
function toggleVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

// Debounce helper
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Show field error
function setField(inputId, msg) {
  const input = document.getElementById(inputId);
  const errEl = document.getElementById(inputId + '-err');
  if (input) input.classList.toggle('input-error', !!msg);
  if (errEl) errEl.textContent = msg || '';
}

// Clear all field errors
function clearErrors(inputIds) {
  inputIds.forEach((id) => setField(id, ''));
}

// Set loading state on button
function setLoading(btn, loading) {
  if (loading) {
    btn.dataset.original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.original || btn.textContent;
  }
}

// Show state message (error/success)
function showState(elId, type, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = 'state-msg ' + type;
  el.textContent = msg;
  el.style.display = 'flex';
}
function hideState(elId) {
  const el = document.getElementById(elId);
  if (el) el.style.display = 'none';
}

// Redirect helper
function go(path) { window.location.href = path; }
