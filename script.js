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
  const modal = document.getElementById('authOverlay');
  const signinBtn = document.getElementById('signin-btn');
  const closeBtn = document.getElementById('authCloseBtn');
  const userProfile = document.getElementById('user-profile');
  const userDisplayName = document.getElementById('user-display-name');
  
  // 1. OPEN FULL SCREEN MODAL
  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      modal.style.display = 'block';
      document.body.style.overflow = 'hidden'; // Completely disable background scroll
    });
  }

  // 2. CLOSE MODAL
  const closeModal = () => {
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
  };

  if (closeBtn) closeBtn.onclick = closeModal;

  // 3. KEYBOARD: ESCAPE TO EXIT
  window.addEventListener('keydown', (e) => {
    if (e.key === "Escape") closeModal();
  });

  // 4. AUTH OBSERVER (INSTANT UI UPDATES)
  onAuthStateChanged(auth, (user) => {
    if (user) {
      closeModal(); // Hide modal immediately on login
      if (signinBtn) signinBtn.style.display = 'none';
      if (userProfile) {
        userProfile.style.display = 'inline-block';
        userDisplayName.textContent = `Signed in as ${user.displayName || user.email.split('@')[0]}`;
      }
    } else {
      if (signinBtn) signinBtn.style.display = 'inline-block';
      if (userProfile) userProfile.style.display = 'none';
    }
  });

  // 5. GOOGLE SIGN IN
  document.getElementById('google-signin-btn').onclick = () => {
    signInWithPopup(auth, provider).catch(err => alert(err.message));
  };

  // 6. LOGOUT
  document.getElementById('logout-link').onclick = (e) => {
    e.preventDefault();
    signOut(auth).then(() => location.reload());
  };

  // 7. THEME & ABOUT TOGGLE (Simplified)
  const themeBtn = document.getElementById('theme-toggle');
  themeBtn.onclick = () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
  };
  document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'light');

  const readBtn = document.getElementById('readBtn');
  const extra = document.getElementById('about-extra');
  if (readBtn && extra) {
    extra.style.display = 'none';
    readBtn.onclick = () => {
      const isHidden = extra.style.display === 'none';
      extra.style.display = isHidden ? 'block' : 'none';
      readBtn.textContent = isHidden ? 'Read Less' : 'Read More';
    };
  }
});