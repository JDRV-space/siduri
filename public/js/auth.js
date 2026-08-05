// SIDURI - JWT Authentication

// Get base path from <base> tag for proper URL resolution
const BASE_PATH = document.querySelector('base')?.href || '/video/studio/';

const loginModal = document.getElementById('loginModal');
const mainContent = document.getElementById('mainContent');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const authHeading = document.getElementById('authHeading');
const loginFields = document.getElementById('loginFields');
const registrationFields = document.getElementById('registrationFields');
const registrationNote = document.getElementById('registrationNote');
const registrationNameInput = document.getElementById('registrationNameInput');
const registrationEmailInput = document.getElementById('registrationEmailInput');
const registrationPasswordInput = document.getElementById('registrationPasswordInput');
const registrationCodeInput = document.getElementById('registrationCodeInput');
const registrationBtn = document.getElementById('registrationBtn');
const registrationError = document.getElementById('registrationError');
const showRegistrationBtn = document.getElementById('showRegistrationBtn');
const showLoginBtn = document.getElementById('showLoginBtn');

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
  configureAuthMode();
}

async function configureAuthMode() {
  if (!loginFields || !registrationFields) return;

  try {
    const res = await fetch(BASE_PATH + 'api/auth/check-first-user');
    if (!res.ok) throw new Error('Unable to determine account setup state');
    const state = await res.json();

    if (state.isFirstUser) {
      authHeading.textContent = 'create owner';
      loginFields.style.display = 'none';
      registrationFields.style.display = 'block';
      registrationNote.textContent = 'Create the first owner account using the setup code from your environment.';
      registrationCodeInput.placeholder = 'owner setup code';
      showLoginBtn.style.display = 'none';
      if (!state.ownerSetupConfigured) {
        showRegistrationError('SIDURI_OWNER_SETUP_CODE is not configured on the server');
        registrationBtn.disabled = true;
      } else {
        registrationError.style.display = 'none';
        registrationBtn.disabled = false;
        registrationEmailInput.focus();
      }
      return;
    }

    authHeading.textContent = 'siduri';
    registrationFields.style.display = 'none';
    loginFields.style.display = 'block';
    emailInput.focus();
  } catch {
    authHeading.textContent = 'siduri';
    registrationFields.style.display = 'none';
    loginFields.style.display = 'block';
    showError('unable to check account setup; try again');
  }
}

function showInvitationRegistration(event) {
  event?.preventDefault();
  authHeading.textContent = 'use invitation';
  loginFields.style.display = 'none';
  registrationFields.style.display = 'block';
  registrationNote.textContent = 'Create an account using the invitation code supplied by the installation owner.';
  registrationCodeInput.placeholder = 'invitation code';
  registrationError.style.display = 'none';
  registrationBtn.disabled = false;
  registrationBtn.textContent = 'create account';
  showLoginBtn.style.display = 'block';
  registrationEmailInput.focus();
}

function showLoginFields(event) {
  event?.preventDefault();
  authHeading.textContent = 'siduri';
  registrationFields.style.display = 'none';
  loginFields.style.display = 'block';
  emailInput.focus();
}

function showApp() {
  // Protected pages just show content, no modal to hide
  if (isProtectedPage) {
    document.dispatchEvent(new CustomEvent('siduri:authenticated', { detail: window.currentUser }));
    return;
  }
  loginModal.style.display = 'none';
  mainContent.style.display = 'block';
  // Show header/nav when logged in
  const header = document.querySelector('.header');
  if (header) header.style.display = 'flex';
  document.dispatchEvent(new CustomEvent('siduri:authenticated', { detail: window.currentUser }));
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

async function handleRegistration() {
  const name = registrationNameInput.value.trim();
  const email = registrationEmailInput.value.trim();
  const password = registrationPasswordInput.value;
  const inviteCode = registrationCodeInput.value.trim();

  if (!email || !password || !inviteCode) {
    showRegistrationError('email, password, and setup or invitation code are required');
    return;
  }
  if (password.length < 12) {
    showRegistrationError('password must be at least 12 characters');
    return;
  }

  registrationBtn.disabled = true;
  registrationBtn.textContent = 'creating...';

  try {
    const res = await fetch(BASE_PATH + 'api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, inviteCode, name: name || undefined })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      window.currentUser = data.user;
      registrationError.style.display = 'none';
      showApp();
      return;
    }
    showRegistrationError(data.error || 'account creation failed');
  } catch {
    showRegistrationError('account creation failed');
  } finally {
    registrationBtn.disabled = false;
    registrationBtn.textContent = 'create account';
  }
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

function showRegistrationError(message) {
  registrationError.textContent = message;
  registrationError.style.display = 'block';
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
if (registrationBtn) {
  registrationBtn.addEventListener('click', handleRegistration);
}
if (registrationCodeInput) {
  registrationCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleRegistration();
  });
}
showRegistrationBtn?.addEventListener('click', showInvitationRegistration);
showLoginBtn?.addEventListener('click', showLoginFields);

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
