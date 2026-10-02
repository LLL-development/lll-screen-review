import { defineConfig } from 'vite'

/**
 * Builds the browser extension into dist-extension/, ready for "Load
 * unpacked" in chrome://extensions.
 *
 * The tool is bundled into one plain script, content.js, with its styles in
 * content.css. The extension injects both into a tab as they are, and the
 * browser won't run a script injected that way as a module, so nothing can be
 * left as an import. Everything in extension/ — the manifest and the
 * background script — is copied across unchanged.
 */
export default defineConfig({
  publicDir: 'extension',
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    // Readable in DevTools when something goes wrong on a real site.
    minify: false,
    lib: {
      entry: 'src/extension/content.ts',
      formats: ['iife'],
      name: 'ScreenReview',
      fileName: () => 'content.js',
      cssFileName: 'content',
    },
    rolldownOptions: {
      checks: {
        // A plain script has no import.meta, so it becomes {}. The one place
        // that reads it, clarify.ts working out the dev server's address, is
        // never called here: the extension sends those requests itself.
        emptyImportMeta: false,
      },
    },
  },
})
