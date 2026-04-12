import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithRedirect, getRedirectResult, 
  onAuthStateChanged, signInWithEmailAndPassword, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// --- THE MAGIC FIX: DYNAMIC AUTH DOMAIN ---
// This automatically matches the authDomain to the URL you are using, 
// preventing Chromebooks, iPhones, and Safari from blocking the login session.
const currentDomain = window.location.hostname;
const dynamicAuthDomain = (currentDomain === 'localhost' || currentDomain === '127.0.0.1') 
    ? "techhouse-87e28.firebaseapp.com" 
    : currentDomain;

const firebaseConfig = {
  apiKey: "AIzaSyB5CZLo-CTT2JZxw6SEVSA_wuxkCuE7aUI",
  authDomain: dynamicAuthDomain, // <-- This changes based on your current link
  projectId: "techhouse-87e28",
  storageBucket: "techhouse-87e28.firebasestorage.app",
  messagingSenderId: "249148429400",
  appId: "1:249148429400:web:8ae888aac7a272392ea62d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CATCH THE REDIRECT (Fires right after you pick your Google account) ---
    getRedirectResult(auth).then((result) => {
        if (result?.user) {
            window.location.replace('index.html');
        }
    }).catch((error) => {
        console.error("Google Auth Error:", error.message);
        alert("Login failed: " + error.message);
    });

    // --- 2. THE TRUTH ENGINE (Updates Navbar UI) ---
    onAuthStateChanged(auth, (user) => {
        const signinBtn = document.getElementById('signin-btn');
        const userProfile = document.getElementById('user-profile');
        const userDisplayName = document.getElementById('user-display-name');
        const isSignInPage = window.location.pathname.includes('sign-in.html');

        if (user) {
            if (signinBtn) signinBtn.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            if (userDisplayName) userDisplayName.textContent = `Hi, ${user.displayName || user.email.split('@')}`;
            
            // If they are on the sign-in page, push them to the homepage
            if (isSignInPage) {
                window.location.replace('index.html');
            }
        } else {
            if (signinBtn) signinBtn.style.display = 'inline-block';
            if (userProfile) userProfile.style.display = 'none';
        }
    });

    // --- 3. GOOGLE LOGIN BUTTON ---
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
        googleBtn.onclick = (e) => {
            e.preventDefault();
            signInWithRedirect(auth, provider); 
        };
    }

    // --- 4. EMAIL LOGIN BUTTON ---
    const emailSigninBtn = document.getElementById('email-signin-btn');
    if (emailSigninBtn) {
        emailSigninBtn.onclick = async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const pass = document.getElementById('password').value;
            if (!email || !pass) return alert("Enter email and password.");
            try {
                await signInWithEmailAndPassword(auth, email, pass);
            } catch (err) { alert(err.message); }
        };
    }

    // --- 5. LOGOUT BUTTON ---
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            signOut(auth).then(() => {
                window.location.replace('index.html'); 
            });
        };
    }

    // --- 6. THEME TOGGLE ---
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
    applyTheme(localStorage.getItem('theme') || 'light');
});