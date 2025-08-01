// Smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault(); // Stop the default jump behavior

        const targetId = this.getAttribute('href'); // Get the ID from the link (e.g., "#about")
        const targetElement = document.querySelector(targetId); // Find the element with that ID

        if (targetElement) {
            targetElement.scrollIntoView({
                behavior: 'smooth' // This is the magic for smooth scrolling!
            });
        }
    });
});

// NEW: Function to show "Coming Soon!" message for specific apps
function showComingSoon(appName) {
    alert(`${appName} is coming soon! Keep an eye out!`);
}