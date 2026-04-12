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
    // --- 1. HANDLE GOOGLE REDIRECT (The Fix for iPhones/PCs) ---
    getRedirectResult(auth).then((result) => {
        if (result?.user) {
            console.log("Redirect sign-in successful");
            window.location.replace('index.html');
        }
    }).catch((error) => {
        console.error("Auth Error:", error.message);
    });

    // --- 2. AUTH OBSERVER (Updates the Navbar) ---
    onAuthStateChanged(auth, (user) => {
        const signinBtn = document.getElementById('signin-btn');
        const userProfile = document.getElementById('user-profile');
        const userDisplayName = document.getElementById('user-display-name');

        if (user) {
            if (signinBtn) signinBtn.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            if (userDisplayName) userDisplayName.textContent = `Hi, ${user.displayName || user.email.split('@')}`;
            
            // If logged in and on sign-in page, go home
            if (window.location.pathname.includes('sign-in.html')) {
                window.location.replace('index.html');
            }
        } else {
            if (signinBtn) signinBtn.style.display = 'inline-block';
            if (userProfile) userProfile.style.display = 'none';
        }
    });

    // --- 3. GOOGLE SIGN IN BUTTON ---
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
        googleBtn.onclick = () => {
            // Using Redirect instead of Popup to avoid the "Stubborn" bug
            signInWithRedirect(auth, provider);
        };
    }

    // --- 4. THEME TOGGLE ---
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.onclick = () => {
            const current = document.body.getAttribute('data-theme');
            const newTheme = current === 'dark' ? 'light' : 'dark';
            document.body.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        };
        document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'light');
    }

    // --- 5. READ MORE TOGGLE ---
    const readBtn = document.getElementById('readBtn');
    const extra = document.getElementById('about-extra');
    if (readBtn && extra) {
        readBtn.onclick = () => {
            const isHidden = extra.style.display === 'none';
            extra.style.display = isHidden ? 'block' : 'none';
            readBtn.textContent = isHidden ? 'Show Less' : 'Read More';
        };
    }

    // --- 6. LOGOUT ---
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            signOut(auth).then(() => window.location.replace('index.html'));
        };
    }
});