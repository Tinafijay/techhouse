import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// --- FIREBASE CONFIG ---
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
  const dropdown = document.getElementById('user-dropdown');

  // --- 1. DROPDOWN CLICK LOGIC (Fixes the "doesn't open" issue) ---
  if (userDisplayName && dropdown) {
    userDisplayName.onclick = (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display === 'block';
      dropdown.style.display = isVisible ? 'none' : 'block';
    };
    // Close dropdown when clicking anywhere else
    window.onclick = () => { dropdown.style.display = 'none'; };
  }

  // --- 2. AUTH OBSERVER ---
  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (signinBtn) signinBtn.style.display = 'none';
      if (userProfile) {
        userProfile.style.display = 'inline-block';
        userDisplayName.textContent = `Signed in as ${user.displayName || user.email.split('@')}`;
      }
      if (window.location.pathname.includes('sign-in.html')) window.location.href = 'index.html';
    } else {
      if (signinBtn) signinBtn.style.display = 'inline-block';
      if (userProfile) userProfile.style.display = 'none';
    }
  });

  // --- 3. SIGN-IN PAGE TOGGLE LOGIC ---
  let isSignUpMode = false;
  const authToggleLink = document.getElementById('auth-toggle-link');
  const authTitle = document.getElementById('auth-title');
  const nameFields = document.getElementById('name-fields');
  const submitBtn = document.getElementById('submit-auth-btn');

  if (authToggleLink) {
    authToggleLink.onclick = (e) => {
      e.preventDefault();
      isSignUpMode = !isSignUpMode;
      authTitle.textContent = isSignUpMode ? "Create Account" : "Welcome Back";
      nameFields.style.display = isSignUpMode ? "flex" : "none";
      submitBtn.textContent = isSignUpMode ? "Sign Up" : "Sign In";
      document.getElementById('toggle-msg').textContent = isSignUpMode ? "Already have an account?" : "Don't have an account?";
      authToggleLink.textContent = isSignUpMode ? "Sign In" : "Create one";
    };
  }

  // --- 4. EMAIL AUTH (Handles both Login and Signup) ---
  if (submitBtn) {
    submitBtn.onclick = async () => {
      const email = document.getElementById('email').value;
      const pass = document.getElementById('password').value;

      try {
        if (isSignUpMode) {
          const fullName = document.getElementById('fname').value + " " + document.getElementById('lname').value;
          const res = await createUserWithEmailAndPassword(auth, email, pass);
          await updateProfile(res.user, { displayName: fullName });
        } else {
          await signInWithEmailAndPassword(auth, email, pass);
        }
        window.location.href = 'index.html';
      } catch (err) { alert(err.message); }
    };
  }

  // --- 5. GOOGLE & LOGOUT ---
  const googleBtn = document.getElementById('google-signin-btn');
  if (googleBtn) {
    googleBtn.onclick = async () => {
      try { await signInWithPopup(auth, provider); } 
      catch (err) { if (err.code !== 'auth/popup-closed-by-user') alert(err.message); }
    };
  }

  const logoutBtn = document.getElementById('logout-link');
  if (logoutBtn) {
    logoutBtn.onclick = (e) => {
      e.preventDefault();
      signOut(auth).then(() => { window.location.href = 'index.html'; });
    };
  }
});