/* Single source of truth for the app version.
   Bump this on EVERY deploy (date-based is easy: YYYY.MM.DD, add .1/.2 for same-day).
   Loaded two ways so the number never drifts:
     - index.html loads it as a normal <script> -> sets window.APP_VERSION (used by the UI)
     - sw.js loads it via importScripts() -> sets self.APP_VERSION (used for the cache name) */
globalThis.APP_VERSION = '2026.06.09.1';
