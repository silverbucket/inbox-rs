/**
 * Stable PWA bootloader.
 *
 * This file deliberately has a permanent URL and no application imports. It
 * must remain capable of rendering recovery UI even when a versioned bundle
 * is stale, missing, or temporarily unavailable during a deployment.
 */
(() => {
  const MANIFEST_URL = '/asset-manifest.json';
  const HISTORY_KEY = 'inbox-rs:boot-manifests';
  const MAX_HISTORY = 5;
  const isCapture = location.pathname.startsWith('/capture');
  const targetId = isCapture ? 'capture-app' : 'app';
  const entryKey = isCapture ? 'src/capture/main.ts' : 'src/main.ts';
  const devEntry = isCapture ? '/src/capture/main.ts' : '/src/main.ts';
  let reloadingForWorker = false;

  function target() {
    return document.getElementById(targetId);
  }

  function renderStatus(title, message, retry) {
    const root = target();
    if (!root) return;
    root.innerHTML = '';

    const main = document.createElement('main');
    main.setAttribute('data-app-loader', '');
    main.style.cssText =
      'min-height:100vh;box-sizing:border-box;display:grid;place-items:center;padding:24px;background:#f8f9fb;color:#20232a;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';

    const card = document.createElement('section');
    card.style.cssText =
      'width:min(100%,420px);box-sizing:border-box;padding:32px;border:1px solid #dfe2e8;border-radius:20px;background:#fff;text-align:center;box-shadow:0 12px 36px rgba(20,25,35,.08)';

    const heading = document.createElement('h1');
    heading.textContent = title;
    heading.style.cssText = 'margin:0;font-size:28px;letter-spacing:-.03em';
    card.appendChild(heading);

    const body = document.createElement('p');
    body.textContent = message;
    body.style.cssText = 'margin:12px 0 0;color:#626b7a';
    card.appendChild(body);

    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Try again';
      button.style.cssText =
        'margin-top:20px;min-height:44px;padding:0 20px;border:0;border-radius:999px;background:#4f46e5;color:#fff;font:inherit;font-weight:700;cursor:pointer';
      button.addEventListener('click', retry);
      card.appendChild(button);
    }

    main.appendChild(card);
    root.appendChild(main);
  }

  function readHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function rememberManifest(manifest) {
    try {
      const serialized = JSON.stringify(manifest);
      const history = readHistory().filter(
        (candidate) => JSON.stringify(candidate) !== serialized,
      );
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([manifest, ...history].slice(0, MAX_HISTORY)),
      );
    } catch {
      // Storage can be unavailable in private or restricted browsing modes.
    }
  }

  async function fetchCurrentManifest() {
    const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Boot manifest request failed: ${response.status}`);
    }
    return response.json();
  }

  function entryFrom(manifest) {
    const entry = manifest?.[entryKey];
    if (!entry || typeof entry.file !== 'string') {
      throw new Error(`Boot manifest is missing ${entryKey}`);
    }
    return entry;
  }

  function loadStyles(files) {
    return Promise.all(
      (files || []).map(
        (file) =>
          new Promise((resolve, reject) => {
            const href = `/${file}`;
            const existing = document.querySelector(
              `link[rel="stylesheet"][href="${href}"]`,
            );
            if (existing) {
              resolve();
              return;
            }
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.onload = resolve;
            link.onerror = () => {
              link.remove();
              reject(new Error(`Stylesheet failed to load: ${href}`));
            };
            document.head.appendChild(link);
          }),
      ),
    );
  }

  async function loadManifest(manifest) {
    const entry = entryFrom(manifest);
    await loadStyles(entry.css);
    await import(`/${entry.file}`);
  }

  async function loadApplication() {
    const candidates = [];
    let manifestUnavailable = false;
    try {
      candidates.push(await fetchCurrentManifest());
    } catch (error) {
      manifestUnavailable = true;
      console.warn('Could not fetch the current app release', error);
    }
    candidates.push(...readHistory());

    const attempted = new Set();
    let lastError;
    for (const manifest of candidates) {
      const fingerprint = JSON.stringify(manifest);
      if (attempted.has(fingerprint)) continue;
      attempted.add(fingerprint);
      try {
        await loadManifest(manifest);
        rememberManifest(manifest);
        return;
      } catch (error) {
        lastError = error;
        console.warn('App release failed to load; trying a fallback', error);
      }
    }
    if (
      manifestUnavailable &&
      (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ) {
      await import(devEntry);
      return;
    }
    throw lastError || new Error('No app release is available');
  }

  async function coordinateServiceWorkerUpdate() {
    if (!('serviceWorker' in navigator)) return;
    const hadController = navigator.serviceWorker.controller !== null;
    const registration = await navigator.serviceWorker.register('/sw.js', {
      updateViaCache: 'none',
    });
    if (!registration) return;

    if (!hadController) {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller && !reloadingForWorker) {
        reloadingForWorker = true;
        location.reload();
      }
      return;
    }

    const activateWaitingWorker = () => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    };

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForWorker) return;
      reloadingForWorker = true;
      location.reload();
    });

    activateWaitingWorker();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') activateWaitingWorker();
      });
    });
    void registration.update();
  }

  renderStatus(
    isCapture ? 'Opening capture…' : 'Opening your inbox…',
    'Loading the latest available app release.',
  );

  void loadApplication()
    .then(() => {
      void coordinateServiceWorkerUpdate().catch((error) => {
        // A registration failure must never replace an already-running app.
        console.warn('Service worker update could not be completed', error);
      });
    })
    .catch((error) => {
      console.error('Inbox RS could not start', error);
      renderStatus(
        'Could not load the app',
        navigator.onLine
          ? 'The app update could not be completed. Try again to check for a repaired release.'
          : 'You appear to be offline and no previously working release is available on this device.',
        () => location.reload(),
      );
    });
})();
