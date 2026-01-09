// ADD THIS TO YOUR script.js
const toggleBtn = document.getElementById('theme-toggle');

// Check if the user already picked a vibe before
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