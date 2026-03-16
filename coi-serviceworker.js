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
                .catch((e) => console.error("COI Fetch Error:", e))
        );
    });
} else {
    (() => {
        // Optimization: Only register if we aren't already isolated
        if (window.crossOriginIsolated) return;

        if (!navigator.serviceWorker) {
            console.error("COI: Service Workers are not supported or you are using file://");
            return;
        }

        navigator.serviceWorker.register(window.location.href, { scope: "./" }).then((registration) => {
            registration.addEventListener("updatefound", () => {
                // If a new worker is found, reload to apply headers immediately
                window.location.reload();
            });

            if (registration.active && !window.crossOriginIsolated) {
                // If worker is active but page isn't isolated, we need one reload
                window.location.reload();
            }
        }, (err) => {
            console.error("COI registration failed: ", err);
        });
    })();
}