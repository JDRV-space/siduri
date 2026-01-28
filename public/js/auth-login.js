// SIDURI - Login/Register page authentication

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const showRegisterBtn = document.getElementById('showRegister');
const showLoginBtn = document.getElementById('showLogin');

// Toggle between login and register
showRegisterBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  loginForm.style.display = 'none';
  registerForm.style.display = 'block';
  checkFirstUser();
});

showLoginBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  registerForm.style.display = 'none';
  loginForm.style.display = 'block';
});

// Check if this is the first user (no invitation code needed)
async function checkFirstUser() {
  try {
    const res = await fetch('/api/auth/check-first-user');
    const data = await res.json();
    const inviteCodeGroup = document.getElementById('inviteCodeGroup');
    const inviteCodeInput = document.getElementById('inviteCode');

    if (data.isFirstUser) {
      inviteCodeGroup.classList.remove('show');
      inviteCodeInput.removeAttribute('required');
    } else {
      inviteCodeGroup.classList.add('show');
      inviteCodeInput.setAttribute('required', 'required');
    }
  } catch (err) {
    // Assume invitation code is required
    document.getElementById('inviteCodeGroup').classList.add('show');
  }
}

// Login handler
document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');

  if (!email || !password) {
    showError(loginError, 'email and password required');
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = 'signing in...';
  loginError.classList.remove('show');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (res.ok) {
      // Redirect to main app
      window.location.href = '/';
    } else {
      showError(loginError, data.error || 'login failed');
    }
  } catch (err) {
    showError(loginError, 'network error - please try again');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'sign in';
  }
});

// Register handler
document.getElementById('registerFormElement').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const inviteCode = document.getElementById('inviteCode').value.trim();
  const registerBtn = document.getElementById('registerBtn');
  const registerError = document.getElementById('registerError');

  if (!email || !password) {
    showError(registerError, 'email and password required');
    return;
  }

  if (password.length < 12) {
    showError(registerError, 'password must be at least 12 characters');
    return;
  }

  registerBtn.disabled = true;
  registerBtn.textContent = 'creating account...';
  registerError.classList.remove('show');

  try {
    const body = { email, password };
    if (name) body.name = name;
    if (inviteCode) body.inviteCode = inviteCode;

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (res.ok) {
      // Redirect to main app
      window.location.href = '/';
    } else {
      showError(registerError, data.error || 'registration failed');
    }
  } catch (err) {
    showError(registerError, 'network error - please try again');
  } finally {
    registerBtn.disabled = false;
    registerBtn.textContent = 'create account';
  }
});

function showError(element, message) {
  element.textContent = message;
  element.classList.add('show');
}
