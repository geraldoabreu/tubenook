import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateAllIcons } from './generate-icons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function collectJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      collectJsFiles(full, out);
    } else if (full.endsWith('.js') || full.endsWith('.mjs')) {
      out.push(full);
    }
  }
  return out;
}

function checkSyntax(files) {
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
}

function verifyManifestAssets(distDir) {
  const manifestPath = path.join(distDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const requiredPaths = [];

  if (manifest.icons) {
    requiredPaths.push(...Object.values(manifest.icons));
  }
  if (manifest.action?.default_popup) {
    requiredPaths.push(manifest.action.default_popup);
  }
  if (manifest.action?.default_icon) {
    requiredPaths.push(...Object.values(manifest.action.default_icon));
  }
  if (manifest.options_page) {
    requiredPaths.push(manifest.options_page);
  }
  if (manifest.background?.service_worker) {
    requiredPaths.push(manifest.background.service_worker);
  }
  for (const cs of manifest.content_scripts || []) {
    requiredPaths.push(...(cs.js || []), ...(cs.css || []));
  }

  const missing = requiredPaths.filter((rel) => !fs.existsSync(path.join(distDir, rel)));
  if (missing.length > 0) {
    throw new Error(`Missing files referenced in manifest.json:\n  - ${missing.join('\n  - ')}`);
  }
}

function build() {
  // 1. Ensure icons exist
  const icon128 = path.join(ROOT, 'assets', 'icons', 'icon128.png');
  if (!fs.existsSync(icon128)) {
    generateAllIcons();
  }

  // 2. Clean dist/
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 3. Copy manifest, assets, and src
  fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
  copyRecursive(path.join(ROOT, 'assets'), path.join(DIST, 'assets'));
  copyRecursive(path.join(ROOT, 'src'), path.join(DIST, 'src'));

  // 4. Syntax-check every JS file in dist/src
  const jsFiles = collectJsFiles(path.join(DIST, 'src'));
  checkSyntax(jsFiles);

  // 5. Verify all manifest references exist in dist/
  verifyManifestAssets(DIST);

  console.log(`Build succeeded: ${jsFiles.length} JS modules checked -> ${DIST}`);
}

build();
