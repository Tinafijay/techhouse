import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithRedirect, 
  onAuthStateChanged, signInWithEmailAndPassword, signOut 
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

    // --- 1. THE OBSERVER (Handles all routing automatically) ---
    onAuthStateChanged(auth, (user) => {
        const signinBtn = document.getElementById('signin-btn');
        const userProfile = document.getElementById('user-profile');
        const userDisplayName = document.getElementById('user-display-name');
        const isSignInPage = window.location.pathname.includes('sign-in.html');

        if (user) {
            // User is officially logged in
            if (signinBtn) signinBtn.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            if (userDisplayName) userDisplayName.textContent = `Hi, ${user.displayName || user.email.split('@')}`;
            
            // If they are stuck on the sign-in page, boot them to the homepage
            if (isSignInPage) {
                window.location.href = 'index.html';
            }
        } else {
            // No user
            if (signinBtn) signinBtn.style.display = 'inline-block';
            if (userProfile) userProfile.style.display = 'none';
        }
    });

    // --- 2. GOOGLE LOGIN ---
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
        googleBtn.onclick = (e) => {
            e.preventDefault();
            signInWithRedirect(auth, provider); 
        };
    }

    // --- 3. EMAIL LOGIN ---
    const emailSigninBtn = document.getElementById('email-signin-btn');
    if (emailSigninBtn) {
        emailSigninBtn.onclick = async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const pass = document.getElementById('password').value;
            if (!email || !pass) return alert("Enter email and password.");
            try {
                await signInWithEmailAndPassword(auth, email, pass);
                // The observer above will instantly handle the redirect!
            } catch (err) { alert(err.message); }
        };
    }

    // --- 4. LOGOUT ---
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            signOut(auth).then(() => {
                window.location.reload(); 
            });
        };
    }

    // --- 5. THEME TOGGLE (Works across all pages) ---
    const themeBtn = document.getElementById('theme-toggle');
    const applyTheme = (theme) => {
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    };

    if (themeBtn) {
        themeBtn.onclick = () => {
            const current = document.body.getAttribute('data-theme');
            applyTheme(current === 'dark' ? 'light' : 'dark');
        };
    }
    // Set theme on initial load
    applyTheme(localStorage.getItem('theme') || 'light');
});