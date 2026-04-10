import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, 
  createUserWithEmailAndPassword, updateProfile, signOut 
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
  const userProfile = document.getElementById('user-profile');
  const userDisplayName = document.getElementById('user-display-name');
  const signinBtn = document.getElementById('signin-btn');

  // --- 1. AUTH OBSERVER ---
  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (signinBtn) signinBtn.style.display = 'none';
      if (userProfile) {
        userProfile.style.display = 'inline-block';
        userDisplayName.textContent = `Hi, ${user.displayName || user.email.split('@')[0]}`;
      }
      // If we are on sign-in page, go home
      if (window.location.pathname.includes('sign-in.html')) window.location.href = 'index.html';
    } else {
      if (signinBtn) signinBtn.style.display = 'inline-block';
      if (userProfile) userProfile.style.display = 'none';
    }
  });

  // --- 2. SIGN IN PAGE LOGIC ---
  const googleBtn = document.getElementById('google-signin-btn');
  if (googleBtn) {
    googleBtn.onclick = () => signInWithPopup(auth, provider).catch(err => alert(err.message));
  }

  const signupBtn = document.getElementById('email-signup-btn');
  if (signupBtn) {
    signupBtn.onclick = async () => {
      const email = document.getElementById('email').value;
      const pass = document.getElementById('password').value;
      const fullName = document.getElementById('fname').value + " " + document.getElementById('lname').value;
      
      try {
        const res = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(res.user, { displayName: fullName });
        window.location.href = 'index.html';
      } catch (err) { alert(err.message); }
    };
  }

  // --- 3. LOGOUT ---
  const logoutBtn = document.getElementById('logout-link');
  if (logoutBtn) {
    logoutBtn.onclick = () => signOut(auth).then(() => location.reload());
  }

  // --- 4. THEME & READ MORE ---
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) {
    themeBtn.onclick = () => {
      const isDark = document.body.getAttribute('data-theme') === 'dark';
      document.body.setAttribute('data-theme', isDark ? 'light' : 'dark');
      localStorage.setItem('theme', isDark ? 'light' : 'dark');
    };
    document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'light');
  }

  const readBtn = document.getElementById('readBtn');
  const extra = document.getElementById('about-extra');
  if (readBtn && extra) {
    readBtn.onclick = () => {
      const isHidden = extra.style.display === 'none';
      extra.style.display = isHidden ? 'block' : 'none';
      readBtn.textContent = isHidden ? 'Read Less' : 'Read My Full Story';
    };
  }
});