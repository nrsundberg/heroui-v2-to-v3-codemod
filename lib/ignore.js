'use strict';

// Directories the codemod should never traverse: generated build artifacts,
// framework caches, vendored dependencies, and version-control metadata.
// Used by jscodeshift's --ignore-pattern, by the CSS scanners, and by the
// framer-motion source-reference grep in package-json.js.
const DEFAULT_IGNORE_GLOBS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  'out/**',
  'coverage/**',
  '.git/**',
  '.next/**',
  '.nuxt/**',
  '.svelte-kit/**',
  '.react-router/**',
  '.cache/**',
  '.turbo/**',
  '.parcel-cache/**',
  '.vercel/**',
  '.netlify/**',
  '.tmp-fixture-out/**',
  '.tmp-fixture-css-out/**',
];

module.exports = { DEFAULT_IGNORE_GLOBS };
