// YOUR ORIGINAL THEME LOGIC (DON'T TOUCH)
const toggleBtn = document.getElementById('theme-toggle');
if (localStorage.getItem('theme') === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    if(toggleBtn) toggleBtn.innerText = "Switch to Light";
}

toggleBtn.addEventListener('click', () => {
    if (document.body.getAttribute('data-theme') === 'dark') {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        toggleBtn.innerText = "Switch to Dark";
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        toggleBtn.innerText = "Switch to Light";
    }
});

// NEW: AUTH STATE LISTENER (Using your Firebase setup)
// Note: Ensure your Firebase config is initialized elsewhere or added here
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.x.x/firebase-auth.js";
const auth = getAuth();

onAuthStateChanged(auth, (user) => {
    const sBtn = document.getElementById('signin-btn');
    const uProf = document.getElementById('user-profile');
    const uName = document.getElementById('user-display-name');

    if (user) {
        sBtn.style.display = 'none';
        uProf.style.display = 'block';
        uName.innerText = `Signed in as ${user.displayName || user.email}`;
    } else {
        sBtn.style.display = 'block';
        uProf.style.display = 'none';
    }
});

window.handleLogout = () => { signOut(auth); };