import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, 
  onAuthStateChanged, signInWithEmailAndPassword, signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// --- 1. CONFIG - Using .web.app (now properly configured!) ---
const firebaseConfig = {
  apiKey: "AIzaSyB5CZLo-CTT2JZxw6SEVSA_wuxkCuE7aUI",
  authDomain: "techhouse-87e28.web.app", // ✅ Configured in Google Cloud Console
  projectId: "techhouse-87e28",
  storageBucket: "techhouse-87e28.firebasestorage.app",
  messagingSenderId: "249148429400",
  appId: "1:249148429400:web:8ae888aac7a272392ea62d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

document.addEventListener('DOMContentLoaded', () => {

    // --- 2. CATCH REDIRECT RESULTS (If the fallback was used) ---
    getRedirectResult(auth).then((result) => {
        if (result?.user) {
            window.location.replace('index.html');
        }
    }).catch((error) => {
        console.error("Redirect Error:", error.message);
    });

    // --- 3. THE TRUTH ENGINE (Updates Navbar UI) ---
    onAuthStateChanged(auth, (user) => {
        const signinBtn = document.getElementById('signin-btn');
        const userProfile = document.getElementById('user-profile');
        const userDisplayName = document.getElementById('user-display-name');
        const isSignInPage = window.location.pathname.includes('sign-in.html');

        if (user) {
            if (signinBtn) signinBtn.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            // ✅ FIXED: Added [0] to properly extract email username
            if (userDisplayName) userDisplayName.textContent = `Hi, ${user.displayName || user.email.split('@')[0]}`;
            
            if (isSignInPage) window.location.replace('index.html');
        } else {
            if (signinBtn) signinBtn.style.display = 'inline-block';
            if (userProfile) userProfile.style.display = 'none';
        }
    });

    // --- 4. GOOGLE LOGIN - REDIRECT MODE (More reliable) ---
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
        googleBtn.onclick = async (e) => {
            e.preventDefault();
            // Use redirect mode directly - works everywhere
            signInWithRedirect(auth, provider);
        };
    }

    // --- 5. EMAIL LOGIN BUTTON ---
    const emailSigninBtn = document.getElementById('email-signin-btn');
    if (emailSigninBtn) {
        emailSigninBtn.onclick = async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const pass = document.getElementById('password').value;
            if (!email || !pass) return alert("Enter email and password.");
            try {
                await signInWithEmailAndPassword(auth, email, pass);
                // ✅ FIXED: Added redirect after successful email login
                window.location.replace('index.html');
            } catch (err) { alert(err.message); }
        };
    }

    // --- 6. LOGOUT BUTTON ---
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            signOut(auth).then(() => {
                window.location.replace('index.html'); 
            });
        };
    }

    // --- 7. THEME TOGGLE ---
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
