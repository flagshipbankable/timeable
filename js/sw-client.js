// Talks to the service worker: registration, the "update available" flow,
// and reading the app version (which lives in sw.js).

let registration = null;
let acceptedUpdate = false;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export async function startServiceWorker({ onUpdateReady }) {
  if (!('serviceWorker' in navigator)) return null;

  // Reload only after Josh taps Update. The first install also changes the
  // controller, and that must not reload the page.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (acceptedUpdate) window.location.reload();
  });

  try {
    registration = await navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    console.warn('timeable: offline support is unavailable.', error);
    return null;
  }

  // A waiting worker only means "update" if an older version is running.
  const announceIfWaiting = () => {
    if (registration.waiting && navigator.serviceWorker.controller) onUpdateReady();
  };
  announceIfWaiting();

  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') announceIfWaiting();
    });
  });

  // Look for a new version whenever the app comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => {});
  });

  return registration;
}

export function applyUpdate() {
  if (!registration || !registration.waiting) return false;
  acceptedUpdate = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

// Returns 'ready', 'downloading', 'current', or 'unavailable'.
export async function checkForUpdate() {
  if (!registration) return 'unavailable';
  try {
    await registration.update();
  } catch {
    return 'unavailable';
  }
  if (registration.waiting) return 'ready';
  if (registration.installing) return 'downloading';
  return 'current';
}

// Asks the running service worker which version it is.
export async function getVersion() {
  if (!('serviceWorker' in navigator)) return null;
  const ready = await withTimeout(navigator.serviceWorker.ready, 3000);
  const worker = navigator.serviceWorker.controller || (ready && ready.active);
  if (!worker) return null;
  return withTimeout(new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve((event.data && event.data.version) || null);
    worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
  }), 2000);
}
