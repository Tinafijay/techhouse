/*! coi-serviceworker.js - v0.2.3 - MIT License */
if (typeof window === 'undefined') {
    self.addEventListener("install", () => self.skipWaiting());
    self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener("fetch", (event) => {
        if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
            return;
        }

        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.status === 0) {
                        return response;
                    }

                    const newHeaders = new Headers(response.headers);
                    newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
                    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch((e) => console.error(e))
        );
    });
} else {
    (() => {
        const script = document.currentScript;
        script.removeAttribute("src");
        const coep = true;

        if (window.crossOriginIsolated !== false || !navigator.serviceWorker) {
            return;
        }

        const registration = navigator.serviceWorker.register(window.location.pathname, { scope: "./" });
        registration.then(() => {
            console.log("COI Service Worker registered.");
            window.location.reload();
        }, (err) => {
            console.error("COI Service Worker registration failed: ", err);
        });
    })();
}