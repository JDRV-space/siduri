// SIDURI - JWT Authentication

// Get base path from <base> tag for proper URL resolution
const BASE_PATH = document.querySelector('base')?.href || '/video/studio/';

const loginModal = document.getElementById('loginModal');
const mainContent = document.getElementById('mainContent');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

// Protected pages (dashboard, settings) declare via meta tag
// These pages don't have login modal - redirect to index if not authenticated
const isProtectedPage = document.querySelector('meta[name="page-type"]')?.content === 'protected';

// Check if already logged in via httpOnly cookie
async function checkAuth() {
  try {
    const res = await fetch(BASE_PATH + 'api/auth/me', {
      credentials: 'include'
    });

    if (res.ok) {
      const data = await res.json();
      window.currentUser = data.user;
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  // Protected pages (dashboard, settings) redirect to index for login
  if (isProtectedPage) {
    window.location.href = './';
    return;
  }
  loginModal.style.display = 'flex';
  mainContent.style.display = 'none';
  // Hide header/nav when not logged in
  const header = document.querySelector('.header');
  if (header) header.style.display = 'none';
  if (emailInput) emailInput.focus();
}

function showApp() {
  // Protected pages just show content, no modal to hide
  if (isProtectedPage) {
    return;
  }
  loginModal.style.display = 'none';
  mainContent.style.display = 'block';
  // Show header/nav when logged in
  const header = document.querySelector('.header');
  if (header) header.style.display = 'flex';
}

async function handleLogin() {
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput.value.trim();

  if (!email) {
    showError('enter your email');
    return;
  }

  if (!password) {
    showError('enter your password');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'checking...';

  try {
    const res = await fetch(BASE_PATH + 'api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      window.currentUser = data.user;
      loginError.style.display = 'none';
      showApp();
    } else {
      showError(data.error || 'invalid credentials');
    }
  } catch (err) {
    showError('login failed');
  }

  loginBtn.disabled = false;
  loginBtn.textContent = 'enter';
}

function showError(message) {
  loginError.textContent = message;
  loginError.style.display = 'block';
  if (emailInput) emailInput.classList.add('error');
  passwordInput.classList.add('error');
  setTimeout(() => {
    if (emailInput) emailInput.classList.remove('error');
    passwordInput.classList.remove('error');
  }, 500);
}

// Event listeners (only on pages with login form)
if (loginBtn) {
  loginBtn.addEventListener('click', handleLogin);
}
if (emailInput) {
  emailInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') passwordInput.focus();
  });
}
if (passwordInput) {
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });
}

// Logout handler
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      await fetch(BASE_PATH + 'api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch {
      // Ignore errors, still show login
    }
    window.currentUser = null;
    showLogin();
  });
}

// Check if authenticated (for other scripts to use)
function isAuthenticated() {
  return !!window.currentUser;
}

// Wrapper for authenticated API calls (uses httpOnly cookie automatically)
async function authenticatedFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  // If unauthorized, redirect to login
  if (res.status === 401) {
    window.currentUser = null;
    showLogin();
  }

  return res;
}

// Initialize
checkAuth();
