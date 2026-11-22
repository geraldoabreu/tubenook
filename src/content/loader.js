// Manifest V3 Content Script ESM Loader
(async () => {
  try {
    await import(chrome.runtime.getURL('src/content/index.js'));
  } catch (err) {
    console.error('[TubePocket] Failed to boot content script:', err);
  }
})();
