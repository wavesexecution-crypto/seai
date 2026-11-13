/* SEAI Business Ops — Private Owner Control Centre */
import { signIn, signOut, getMe, api } from './api.js';
import * as overview from './pages/overview.js';
import * as crm from './pages/crm.js';
import * as social from './pages/social.js';
import * as advertising from './pages/advertising.js';
import * as content from './pages/content.js';
import * as communications from './pages/communications.js';
import * as clients from './pages/clients.js';
import * as projects from './pages/projects.js';
import * as finance from './pages/finance.js';
import * as automations from './pages/automations.js';
import * as reports from './pages/reports.js';
import * as settings from './pages/settings.js';

const pages = {};
let currentPage = null;
let currentUser = null;

const shell = document.getElementById('app-shell');
const gate = document.getElementById('auth-gate');
const signInForm = document.getElementById('sign-in-form');
const authError = document.getElementById('auth-error');
const pageContainer = document.getElementById('page-container');
const pageTitle = document.getElementById('page-title');
const pageSub = document.getElementById('page-sub');
const userChip = document.getElementById('user-chip');
const roleBadge = document.getElementById('role-badge');
const signOutBtn = document.getElementById('sign-out-btn');

export function registerPage(id, module) {
  pages[id] = module;
}

export async function navigate(id) {
  if (currentPage && pages[currentPage].onLeave) pages[currentPage].onLeave();
  currentPage = id;

  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('on', el.dataset.page === id);
  });

  const mod = pages[id];
  pageTitle.textContent = mod.title || id;
  pageSub.textContent = mod.subtitle || '';

  pageContainer.innerHTML = '';
  if (mod.render) {
    const el = await mod.render(pageContainer);
    pageContainer.appendChild(el);
  }

  if (mod.onEnter) mod.onEnter();
}

async function initApp() {
  const user = await getMe();
  if (!user) {
    shell.style.display = 'none';
    gate.style.display = 'flex';
    return;
  }

  currentUser = user;
  userChip.textContent = `${user.full_name} · ${user.email}`;
  roleBadge.textContent = 'Owner';
  shell.style.display = 'grid';
  gate.style.display = 'none';

  const hash = location.hash.replace('#', '') || 'overview';
  navigate(hash);

  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#', '') || 'overview';
    navigate(id);
  });
}

// Register all 12 pages
registerPage('overview', overview);
registerPage('crm', crm);
registerPage('social', social);
registerPage('advertising', advertising);
registerPage('content', content);
registerPage('communications', communications);
registerPage('clients', clients);
registerPage('projects', projects);
registerPage('finance', finance);
registerPage('automations', automations);
registerPage('reports', reports);
registerPage('settings', settings);

signInForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(signInForm);
  const email = fd.get('email');
  const password = fd.get('password');
  try {
    await signIn(email, password);
    await initApp();
  } catch (err) {
    authError.textContent = err.message;
    authError.style.display = 'block';
  }
});

signOutBtn.addEventListener('click', async () => {
  await signOut();
  shell.style.display = 'none';
  gate.style.display = 'flex';
  location.hash = '';
});

window.addEventListener('ops:unauthorized', () => {
  shell.style.display = 'none';
  gate.style.display = 'flex';
  alert('Session expired. Please sign in again.');
});

window.SEAI_OPS = { navigate, registerPage, api, getCurrentUser: () => currentUser };

initApp();
