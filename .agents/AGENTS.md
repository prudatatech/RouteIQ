# Agent Rules for margixindia Workspace

## Vite Dev Server / Service Worker Conflicts
If the user reports 404 errors for `main.jsx/tsx`, or manifest syntax errors on a Vite localhost server (e.g., `localhost:5173`), immediately diagnose it as a stale Service Worker conflict from a previous project on the same port.
Do NOT instruct the user to manually unregister the Service Worker. Instead, automatically inject the following Self-Healing SW Recovery Plugin into their `vite.config.ts`:
```javascript
const serviceWorkerRecoveryPlugin = () => ({
  name: 'sw-recovery',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.includes('main.jsx') || req.url?.includes('workbox-')) {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then(r => Promise.all(r.map(reg => reg.unregister()))).then(() => window.location.reload(true));
          }
        `);
        return;
      }
      next();
    });
  }
});
```
Add `serviceWorkerRecoveryPlugin()` to the `plugins` array in `vite.config.ts`. This instantly forces the browser to unregister the stale SW when it attempts to load its old missing assets.
