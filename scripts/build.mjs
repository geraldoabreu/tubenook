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

function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Zero-dependency ESM -> IIFE content-script bundler.
 * Wraps each reachable ES module in its own closure so top-level identifiers
 * never collide, eliminating dynamic `import(chrome.runtime.getURL(...))`
 * cross-origin errors in Chromium and Opera.
 */
function bundleContentScript(entryRel, distDir) {
  const visited = new Set();
  const ordered = [];

  function resolveModule(fromAbs, specifier) {
    const baseDir = path.dirname(fromAbs);
    let target = path.resolve(baseDir, specifier);
    if (!fs.existsSync(target) && fs.existsSync(`${target}.js`)) {
      target = `${target}.js`;
    }
    if (!fs.existsSync(target)) {
      throw new Error(`Bundler could not resolve "${specifier}" from ${fromAbs}`);
    }
    return target;
  }

  function transformModule(fileAbs) {
    const relId = toPosix(path.relative(ROOT, fileAbs));
    if (visited.has(relId)) return;
    visited.add(relId);

    let code = fs.readFileSync(fileAbs, 'utf8');
    const deps = [];
    const exportedNames = new Set();

    // 1. Rewrite static import statements (handles multiline named imports, namespace, default, side-effect)
    code = code.replace(
      /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/gm,
      (_match, clause, spec) => {
        const depAbs = resolveModule(fileAbs, spec);
        const depId = toPosix(path.relative(ROOT, depAbs));
        deps.push(depAbs);
        const trimmed = clause.trim();
        if (trimmed.startsWith('* as ')) {
          const ns = trimmed.slice(5).trim();
          return `const ${ns} = __require(${JSON.stringify(depId)});`;
        }
        if (trimmed.startsWith('{')) {
          const inner = trimmed.slice(1, -1).replace(/\bas\b/g, ':');
          return `const { ${inner} } = __require(${JSON.stringify(depId)});`;
        }
        // default + optional named
        const commaIdx = trimmed.indexOf(',');
        if (commaIdx !== -1) {
          const defName = trimmed.slice(0, commaIdx).trim();
          const rest = trimmed.slice(commaIdx + 1).trim();
          const inner = rest.slice(1, -1).replace(/\bas\b/g, ':');
          return `const __imp_${defName} = __require(${JSON.stringify(depId)}); const ${defName} = __imp_${defName}.default; const { ${inner} } = __imp_${defName};`;
        }
        return `const ${trimmed} = __require(${JSON.stringify(depId)}).default;`;
      }
    );

    // Side-effect only imports: import './foo.js';
    code = code.replace(/^import\s+['"]([^'"]+)['"]\s*;?/gm, (_match, spec) => {
      const depAbs = resolveModule(fileAbs, spec);
      const depId = toPosix(path.relative(ROOT, depAbs));
      deps.push(depAbs);
      return `__require(${JSON.stringify(depId)});`;
    });

    // 2. Rewrite export declarations
    code = code.replace(/^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, (_m, asyncKw, name) => {
      exportedNames.add(name);
      return `${asyncKw || ''}function ${name}`;
    });
    code = code.replace(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm, (_m, name) => {
      exportedNames.add(name);
      return `class ${name}`;
    });
    code = code.replace(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_m, kw, name) => {
      exportedNames.add(name);
      return `${kw} ${name}`;
    });
    code = code.replace(/^export\s+default\s+/gm, 'exports.default = ');

    // export { a, b as c };
    code = code.replace(/^export\s*\{([\s\S]*?)\}\s*;?/gm, (_m, list) => {
      const assigns = list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((item) => {
          const parts = item.split(/\s+as\s+/);
          const local = parts[0].trim();
          const exp = (parts[1] || parts[0]).trim();
          return `exports.${exp} = ${local};`;
        });
      return assigns.join('\n');
    });

    const footer = [...exportedNames].map((n) => `exports.${n} = ${n};`).join('\n');
    for (const depAbs of deps) {
      transformModule(depAbs);
    }
    ordered.push({ relId, code: `${code}\n${footer}\n` });
  }

  const entryAbs = path.join(ROOT, entryRel);
  const entryId = toPosix(path.relative(ROOT, entryAbs));
  transformModule(entryAbs);

  const chunks = [
    '// TubeNook Manifest V3 Content Script Bundle (generated by scripts/build.mjs)',
    '(() => {',
    '  "use strict";',
    '  const __modules = Object.create(null);',
    '  const __cache = Object.create(null);',
    '  function __require(id) {',
    '    if (__cache[id]) return __cache[id].exports;',
    '    const mod = { exports: {} };',
    '    __cache[id] = mod;',
    '    if (!__modules[id]) throw new Error("[TubeNook] Missing bundled module: " + id);',
    '    __modules[id](mod.exports, __require, mod);',
    '    return mod.exports;',
    '  }',
  ];

  for (const mod of ordered) {
    chunks.push(`  __modules[${JSON.stringify(mod.relId)}] = function(exports, __require, module) {`);
    chunks.push(mod.code);
    chunks.push('  };');
  }

  chunks.push(`  __require(${JSON.stringify(entryId)});`);
  chunks.push('})();\n');

  const outPath = path.join(distDir, 'src', 'content', 'content.bundle.js');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, chunks.join('\n'), 'utf8');
  return outPath;
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

  // 4. Bundle content script into classic IIFE (no dynamic chrome-extension:// imports)
  bundleContentScript('src/content/index.js', DIST);

  // 5. Syntax-check every JS file in dist/src (including content.bundle.js)
  const jsFiles = collectJsFiles(path.join(DIST, 'src'));
  checkSyntax(jsFiles);

  // 6. Verify all manifest references exist in dist/
  verifyManifestAssets(DIST);

  console.log(`Build succeeded: ${jsFiles.length} JS modules checked -> ${DIST}`);
}

build();
