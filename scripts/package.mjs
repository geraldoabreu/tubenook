import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT, 'release');

function runBuild() {
  const buildScript = path.join(ROOT, 'scripts', 'build.mjs');
  execFileSync(process.execPath, [buildScript], { stdio: 'inherit' });
}

function verifyDistManifest() {
  const manifestPath = path.join(DIST, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing dist/manifest.json at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.manifest_version !== 3) {
    throw new Error(`Expected manifest_version 3, got ${manifest.manifest_version}`);
  }
  if (!manifest.name || !manifest.version) {
    throw new Error('dist/manifest.json must include both "name" and "version"');
  }

  const requiredFiles = [
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    manifest.action?.default_popup,
    manifest.options_page,
    manifest.background?.service_worker,
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ].filter(Boolean);

  const missing = requiredFiles.filter((rel) => !fs.existsSync(path.join(DIST, rel)));
  if (missing.length > 0) {
    throw new Error(`Missing assets in dist/:\n  - ${missing.join('\n  - ')}`);
  }

  return manifest;
}

function createZip(zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) {
    fs.rmSync(zipPath, { force: true });
  }

  if (process.platform === 'win32') {
    const escapedDist = path.join(DIST, '*').replace(/'/g, "''");
    const escapedZip = zipPath.replace(/'/g, "''");
    const psCmd = `$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${escapedDist}' -DestinationPath '${escapedZip}' -CompressionLevel Optimal -Force`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
      stdio: 'inherit',
    });
  } else {
    execFileSync('zip', ['-r', '-q', zipPath, '.'], {
      cwd: DIST,
      stdio: 'inherit',
    });
  }

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Zip archive was not created at ${zipPath}`);
  }
}

function main() {
  console.log('1/3 Running build...');
  runBuild();

  console.log('2/3 Verifying dist/manifest.json...');
  const manifest = verifyDistManifest();

  const safeVersion = String(manifest.version).replace(/[^0-9A-Za-z._-]/g, '');
  const zipName = `tubenook-v${safeVersion}.zip`;
  const zipPath = path.join(RELEASE_DIR, zipName);

  console.log(`3/3 Packaging dist/ -> ${path.relative(ROOT, zipPath)}...`);
  createZip(zipPath);

  const sizeKb = (fs.statSync(zipPath).size / 1024).toFixed(1);
  console.log(`Package ready for Chrome Web Store: ${path.relative(ROOT, zipPath)} (${sizeKb} KB)`);
}

main();
