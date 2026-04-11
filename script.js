import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut 
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
    // 1. Auth State Observer (Updates Nav Bar)
    onAuthStateChanged(auth, (user) => {
        const signinBtn = document.getElementById('signin-btn');
        const userProfile = document.getElementById('user-profile');
        const userDisplayName = document.getElementById('user-display-name');

        if (user && userDisplayName) {
            if(signinBtn) signinBtn.style.display = 'none';
            if(userProfile) userProfile.style.display = 'flex';
            userDisplayName.textContent = `Signed in as ${user.displayName || user.email.split('@')}`;
        } else if (signinBtn) {
            signinBtn.style.display = 'inline-block';
            if(userProfile) userProfile.style.display = 'none';
        }
    });

    // 2. Toggle Login/Signup Mode
    let isSignUp = false;
    const toggleLink = document.getElementById('auth-toggle-link');
    const nameFields = document.getElementById('name-fields');
    const authTitle = document.getElementById('auth-title');
    const submitBtn = document.getElementById('submit-auth-btn');

    if (toggleLink) {
        toggleLink.onclick = (e) => {
            e.preventDefault();
            isSignUp = !isSignUp;
            nameFields.style.display = isSignUp ? 'flex' : 'none';
            authTitle.textContent = isSignUp ? 'Create Account' : 'Sign In';
            submitBtn.textContent = isSignUp ? 'Register' : 'Login to Tech House';
            document.getElementById('toggle-text').textContent = isSignUp ? 'Already have an account?' : 'New to Tech House?';
            toggleLink.textContent = isSignUp ? 'Sign In' : 'Create Account';
        };
    }

    // 3. Form Submission (Login vs Register)
    if (submitBtn) {
        submitBtn.onclick = async () => {
            const email = document.getElementById('email').value;
            const pass = document.getElementById('password').value;
            try {
                if (isSignUp) {
                    const name = document.getElementById('fname').value + " " + document.getElementById('lname').value;
                    const res = await createUserWithEmailAndPassword(auth, email, pass);
                    await updateProfile(res.user, { displayName: name });
                } else {
                    await signInWithEmailAndPassword(auth, email, pass);
                }
                window.location.href = 'index.html'; // REDIRECT BACK HOME
            } catch (err) { alert(err.message); }
        };
    }

    // 4. Google Login
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
        googleBtn.onclick = async () => {
            try {
                await signInWithPopup(auth, provider);
                window.location.href = 'index.html'; // REDIRECT BACK HOME
            } catch (err) { console.error(err); }
        };
    }

    // 5. Logout
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            signOut(auth).then(() => { window.location.href = 'index.html'; });
        };
    }

    // 6. Theme Toggle (Restored)
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.onclick = () => {
            const body = document.body;
            const isDark = body.getAttribute('data-theme') === 'dark';
            body.setAttribute('data-theme', isDark ? 'light' : 'dark');
            localStorage.setItem('theme', isDark ? 'light' : 'dark');
        };
        if(localStorage.getItem('theme') === 'dark') document.body.setAttribute('data-theme', 'dark');
    }
});