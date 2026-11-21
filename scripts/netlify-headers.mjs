// Generates dist/_headers from the [[headers]] blocks in netlify.toml.
// Netlify applies `_headers` from the published folder even for drag-and-drop
// deploys (which don't run a build), so this keeps netlify.toml the single source
// of truth for both deploy styles. Harmless on other hosts.
import { readFileSync, writeFileSync } from 'node:fs';

const toml = readFileSync('netlify.toml', 'utf8');
const out = [];
for (const block of toml.split('[[headers]]').slice(1)) {
  const path = block.match(/for\s*=\s*"([^"]+)"/)?.[1];
  if (!path) continue;
  const values = block.split('[headers.values]')[1] ?? '';
  const lines = [...values.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"/gm)].map((m) => `  ${m[1]}: ${m[2]}`);
  out.push(path, ...lines, '');
}
writeFileSync('dist/_headers', `# Generated from netlify.toml by scripts/netlify-headers.mjs\n${out.join('\n')}`);
console.log(`[netlify-headers] wrote dist/_headers (${out.filter((l) => l.startsWith('/')).length} rules)`);
