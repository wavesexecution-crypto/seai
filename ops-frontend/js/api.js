/* SEAI Business Ops — API client */
const API_BASE = '/api/ops';

let token = null;

export function setAuthToken(t) { token = t; }

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('ops:unauthorized'));
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

// Session cookie auth (same-origin). The backend sets the seai_session cookie.
export async function signIn(email, password) {
  const res = await fetch('/api/auth/sign-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Sign in failed');
  }
  const data = await res.json();
  return data.user;
}

export async function signOut() {
  await fetch('/api/auth/sign-out', { method: 'POST', credentials: 'same-origin' });
}

export async function getMe() {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user;
}
