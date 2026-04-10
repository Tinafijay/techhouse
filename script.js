import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB5CZLo-CTT2JZxw6SEVSA_wuxkCuE7aUI",
  authDomain: "techhouse-87e28.firebaseapp.com",
  projectId: "techhouse-87e28",
  storageBucket: "techhouse-87e28.firebasestorage.app",
  messagingSenderId: "249148429400",
  appId: "1:249148429400:web:8ae888aac7a272392ea62d",
  measurementId: "G-YC3KD6YWMH"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

document.addEventListener('DOMContentLoaded', () => {
  
  // --- DOM Elements ---
  const modal = document.getElementById('authOverlay');
  const signinBtn = document.getElementById('signin-btn');
  const closeBtn = document.getElementById('authCloseBtn');
  const readBtn = document.getElementById('readBtn');
  const aboutExtra = document.getElementById('about-extra');
  const themeToggle = document.getElementById('theme-toggle');
  const userProfile = document.getElementById('user-profile');
  const userDisplayName = document.getElementById('user-display-name');
  const googleBtn = document.getElementById('google-signin-btn');
  const emailSignupBtn = document.getElementById('email-signup-btn');
  const logoutLink = document.getElementById('logout-link');

  // --- Ensure "About Extra" starts hidden ---
  if (aboutExtra) aboutExtra.style.display = 'none';

  // --- Modal Logic ---
  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  // --- Read More Logic ---
  if (readBtn && aboutExtra) {
    readBtn.addEventListener('click', () => {
      if (aboutExtra.style.display === 'none') {
        aboutExtra.style.display = 'block';
        readBtn.textContent = 'Read Less';
      } else {
        aboutExtra.style.display = 'none';
        readBtn.textContent = 'Read More';
      }
    });
  }

  // --- Theme Toggle ---
  const applyTheme = (theme) => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  };

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const current = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(current);
    });
  }
  applyTheme(localStorage.getItem('theme') || 'light');

  // --- Firebase Auth ---
  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (signinBtn) signinBtn.style.display = 'none';
      if (userProfile) userProfile.style.display = 'inline-block';
      if (userDisplayName) userDisplayName.textContent = user.displayName || user.email;
    } else {
      if (signinBtn) signinBtn.style.display = 'inline-block';
      if (userProfile) userProfile.style.display = 'none';
    }
  });

  if (googleBtn) {
    googleBtn.addEventListener('click', () => {
      signInWithPopup(auth, provider).then(() => modal.style.display = 'none');
    });
  }

  if (emailSignupBtn) {
    emailSignupBtn.addEventListener('click', async () => {
      const email = document.getElementById('email').value;
      const pass = document.getElementById('password').value;
      const name = document.getElementById('fname').value + " " + document.getElementById('lname').value;
      
      try {
        const res = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(res.user, { displayName: name });
        modal.style.display = 'none';
      } catch (err) { alert(err.message); }
    });
  }

  if (logoutLink) {
    logoutLink.addEventListener('click', () => {
      signOut(auth).then(() => location.reload());
    });
  }

  // --- App Placeholders ---
  document.querySelectorAll('.app-item-placeholder').forEach(item => {
    item.addEventListener('click', () => {
      alert(item.querySelector('h3').textContent + " is coming soon!");
    });
  });
});