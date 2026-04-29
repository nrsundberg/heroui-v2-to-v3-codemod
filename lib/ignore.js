'use strict';

// Directories the codemod should never traverse: generated build artifacts,
// framework caches, vendored dependencies, and version-control metadata.
// Used by jscodeshift's --ignore-pattern, by the CSS scanners, and by the
// framer-motion source-reference grep in package-json.js.
//
// Why the leading `**/`: jscodeshift checks ignore patterns against
// ABSOLUTE paths (e.g. `/Users/x/proj/node_modules/foo.js`) using micromatch.
// A pattern like `node_modules/**` doesn't have a leading wildcard so it
// matches NOTHING when the input path is absolute. `**/node_modules/**`
// works everywhere — both micromatch (jscodeshift) and fast-glob's `ignore`.
const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.react-router/**',
  '**/.cache/**',
  '**/.turbo/**',
  '**/.parcel-cache/**',
  '**/.vercel/**',
  '**/.netlify/**',
];

module.exports = { DEFAULT_IGNORE_GLOBS };
