import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

    // 1. Modal Logic
    if (signinBtn) signinBtn.onclick = () => { modal.style.display = 'flex'; };
    if (closeBtn) closeBtn.onclick = () => { modal.style.display = 'none'; };
    window.addEventListener('keydown', (e) => { if (e.key === "Escape") modal.style.display = 'none'; });

    // 2. Auth Logic
    onAuthStateChanged(auth, (user) => {
        if (user) {
            modal.style.display = 'none';
            signinBtn.style.display = 'none';
            userProfile.style.display = 'block';
            userDisplayName.textContent = `Hi, ${user.displayName || user.email.split('@')[0]}`;
        } else {
            signinBtn.style.display = 'block';
            userProfile.style.display = 'none';
        }
    });

    document.getElementById('google-signin-btn').onclick = () => signInWithPopup(auth, provider);
    document.getElementById('logout-link').onclick = () => signOut(auth).then(() => location.reload());

    // 3. Theme Toggle
    document.getElementById('theme-toggle').onclick = () => {
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
        localStorage.setItem('theme', isDark ? 'light' : 'dark');
    };
    document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'light');

    // 4. Read More
    const readBtn = document.getElementById('readBtn');
    const extra = document.getElementById('about-extra');
    if (readBtn && extra) {
        readBtn.onclick = () => {
            const isHidden = extra.style.display === 'none';
            extra.style.display = isHidden ? 'block' : 'none';
            readBtn.textContent = isHidden ? 'Read Less' : 'Read More';
        };
    }
});