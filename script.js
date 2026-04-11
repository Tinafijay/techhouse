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
    const signinBtn = document.getElementById('signin-btn');
    const userProfile = document.getElementById('user-profile');
    const userDisplayName = document.getElementById('user-display-name');

    // --- 1. THE OBSERVER (The "Guard") ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log("User detected:", user.displayName);
            if (signinBtn) signinBtn.style.display = 'none';
            if (userProfile) userProfile.style.display = 'flex';
            if (userDisplayName) {
                userDisplayName.textContent = `Signed in as ${user.displayName || user.email.split('@')}`;
            }

            // ONLY redirect if we are currently stuck on the sign-in page
            if (window.location.pathname.includes('sign-in.html')) {
                window.location.replace('index.html'); 
            }
        } else {
            console.log("No user signed in.");
            if (signinBtn) signinBtn.style.display = 'inline-block';
            if (userProfile) userProfile.style.display = 'none';
        }
    });

    // --- 2. GOOGLE SIGN IN (The Fix) ---
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
        googleBtn.onclick = async () => {
            try {
                // Using 'replace' to ensure we don't create a "back button" loop
                const result = await signInWithPopup(auth, provider);
                if (result.user) {
                    window.location.replace('index.html');
                }
            } catch (err) {
                console.error("Auth Error:", err.code);
                alert("Google Sign-in failed: " + err.message);
            }
        };
    }

    // --- 3. LOGIN/SIGNUP TOGGLE (Your Specific Request) ---
    let isSignUp = false;
    const toggleLink = document.getElementById('auth-toggle-link');
    const nameFields = document.getElementById('name-fields');
    const authTitle = document.getElementById('auth-title');
    const submitBtn = document.getElementById('submit-auth-btn');

    if (toggleLink) {
        toggleLink.onclick = (e) => {
            e.preventDefault();
            isSignUp = !isSignUp;
            
            // Toggle Fields
            nameFields.style.display = isSignUp ? 'flex' : 'none';
            
            // Toggle Text
            authTitle.textContent = isSignUp ? 'Create Account' : 'Sign In';
            submitBtn.textContent = isSignUp ? 'Register' : 'Login to Tech House';
            toggleLink.textContent = isSignUp ? 'Sign In' : 'Create Account';
            document.getElementById('toggle-text').textContent = isSignUp ? 'Already have an account?' : 'New to Tech House?';
        };
    }

    // --- 4. EMAIL AUTH (Login vs Signup) ---
    if (submitBtn) {
        submitBtn.onclick = async () => {
            const email = document.getElementById('email').value;
            const pass = document.getElementById('password').value;
            
            if(!email || !pass) return alert("Please fill all fields");

            try {
                if (isSignUp) {
                    const fname = document.getElementById('fname').value;
                    const lname = document.getElementById('lname').value;
                    const res = await createUserWithEmailAndPassword(auth, email, pass);
                    await updateProfile(res.user, { displayName: `${fname} ${lname}` });
                } else {
                    await signInWithEmailAndPassword(auth, email, pass);
                }
                window.location.replace('index.html');
            } catch (err) { alert(err.message); }
        };
    }

    // --- 5. LOGOUT ---
    const logoutBtn = document.getElementById('logout-link');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            signOut(auth).then(() => {
                window.location.replace('index.html');
            });
        };
    }
});