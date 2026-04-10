// ... (Firebase imports and config stay the same) ...

const init = () => {
  const modal = document.getElementById('authOverlay');
  const signinBtn = document.getElementById('signin-btn');
  const closeBtn = document.getElementById('authCloseBtn');
  const userProfile = document.getElementById('user-profile');
  const userGreeting = document.getElementById('user-greeting');
  const logoutBtn = document.getElementById('logout-btn');

  // 1. OPEN MODAL (Full Screen)
  if (signinBtn) {
    signinBtn.addEventListener('click', () => {
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden'; // Stop scrolling
    });
  }

  // 2. CLOSE MODAL
  const closeModal = () => {
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
  };

  if (closeBtn) closeBtn.onclick = closeModal;

  // 3. ESCAPE KEY TO CLOSE
  window.addEventListener('keydown', (e) => {
    if (e.key === "Escape") closeModal();
  });

  // 4. AUTH STATE OBSERVER (Instant Update)
  onAuthStateChanged(auth, (user) => {
    if (user) {
      closeModal(); // Close modal if they are logged in
      if (signinBtn) signinBtn.style.display = 'none';
      if (userProfile) {
        userProfile.style.display = 'flex';
        // Show "Signed in as [Name]"
        userGreeting.textContent = `Signed in as ${user.displayName || user.email.split('@')[0]}`;
      }
    } else {
      if (signinBtn) signinBtn.style.display = 'block';
      if (userProfile) userProfile.style.display = 'none';
    }
  });

  // 5. GOOGLE LOGIN
  const googleBtn = document.getElementById('google-signin-btn');
  if (googleBtn) {
    googleBtn.onclick = () => {
      signInWithPopup(auth, provider).catch(err => alert(err.message));
    };
  }

  // 6. LOGOUT
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      signOut(auth).then(() => {
        location.reload();
      });
    };
  }

  // ... (Theme and Read More logic remains the same) ...
};

// Start the app
init();