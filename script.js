import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, 
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, 
  updateProfile, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB5CZLo-CTT2JZxw6SEVSA_wuxkCuE7aUI",
  authDomain: "techhouse-87e28.firebaseapp.com",
  projectId: "techhouse-87e28",
  storageBucket: "techhouse-87e28.firebasestorage.app",
  messagingSenderId: "249148429400",
  appId: "1:249148429400:web:8ae888aac7a272392ea62d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

document.addEventListener('DOMContentLoaded', () => {
  // --- 1. HANDLE REDIRECT RESULT (The iPhone Fix) ---
  // This checks if the user just returned from Google
  getRedirectResult(auth).catch((error) => {
    if (error.code !== 'auth/redirect-cancelled-by-user') {
        console.error("Auth Error:", error.message);
    }
  });

  // --- 2. THEME TOGGLE (Fixed) ---
  const themeBtn = document.getElementById('theme-toggle');
  const applyTheme = (theme) => {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  };

  if (themeBtn) {
    themeBtn.onclick = () => {
      const current = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(current);
    };
  }
  applyTheme(localStorage.getItem('theme') || 'light');

  // --- 3. READ MORE BUTTON (Fixed) ---
  const readBtn = document.getElementById('readBtn');
  const extraStory = document.getElementById('about-extra');
  if (readBtn && extraStory) {
    readBtn.onclick = () => {
      if (extraStory.style.display === 'none') {
        extraStory.style.display = 'block';
        readBtn.textContent = 'Show Less';
      } else {
        extraStory.style.display = 'none';
        readBtn.textContent = 'Read My Full Story';
      }
    };
  }

  // --- 4. AUTH STATE OBSERVER ---
  onAuthStateChanged(auth, (user) => {
    const signinBtn = document.getElementById('signin-btn');
    const userProfile = document.getElementById('user-profile');
    const userDisplayName = document.getElementById('user-display-name');

    if (user) {
      if (signinBtn) signinBtn.style.display = 'none';
      if (userProfile) userProfile.style.display = 'flex';
      if (userDisplayName) userDisplayName.textContent = `Hi, ${user.displayName || user.email.split('@')}`;
      // If user is on sign-in page, send them home
      if (window.location.pathname.includes('sign-in.html')) window.location.replace('index.html');
    } else {
      if (signinBtn) signinBtn.style.display = 'inline-block';
      if (userProfile) userProfile.style.display = 'none';
    }
  });

  // --- 5. GOOGLE LOGIN (No more Pop-ups) ---
  const googleBtn = document.getElementById('google-signin-btn');
  if (googleBtn) {
    googleBtn.onclick = () => signInWithRedirect(auth, provider);
  }

  // --- 6. EMAIL SIGN UP (Your current logic) ---
  const emailSignupBtn = document.getElementById('email-signup-btn');
  if (emailSignupBtn) {
    emailSignupBtn.onclick = async () => {
      const email = document.getElementById('email').value;
      const pass = document.getElementById('password').value;
      const fname = document.getElementById('fname').value;
      const lname = document.getElementById('lname').value;

      try {
        const res = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(res.user, { displayName: `${fname} ${lname}` });
        window.location.replace('index.html');
      } catch (err) { alert(err.message); }
    };
  }

  // --- 7. LOGOUT ---
  const logoutBtn = document.getElementById('logout-link');
  if (logoutBtn) {
    logoutBtn.onclick = () => signOut(auth).then(() => window.location.replace('index.html'));
  }
});