import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ytDomMod from '../src/content/yt-dom.js';
import {
  parseDurationToSeconds,
  parseViewsCount,
  extractVideoIdFromUrl,
  escapeHtml,
} from '../src/content/yt-dom.js';
import * as brandMod from '../src/shared/brand.js';
import * as sidebarMod from '../src/content/sidebar.js';
import * as subsMod from '../src/content/subscriptions.js';
import * as playlistsMod from '../src/content/playlists.js';
import * as coursesMod from '../src/content/courses.js';
import * as deckMod from '../src/content/deck.js';
import * as indexMod from '../src/content/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

describe('yt-dom.js — Pure Parsing & Helper Functions', () => {
  it('parseDurationToSeconds handles H:MM:SS, MM:SS, SHORTS, LIVE, and invalid input', () => {
    assert.equal(parseDurationToSeconds('0:45'), 45);
    assert.equal(parseDurationToSeconds('12:34'), 12 * 60 + 34);
    assert.equal(parseDurationToSeconds('1:02:03'), 3600 + 2 * 60 + 3);
    assert.equal(parseDurationToSeconds('10:00:00'), 36000);
    assert.equal(parseDurationToSeconds('SHORTS'), 60);
    assert.equal(parseDurationToSeconds('short'), 60);
    assert.equal(parseDurationToSeconds('LIVE'), 0);
    assert.equal(parseDurationToSeconds('AO VIVO'), 0);
    assert.equal(parseDurationToSeconds(''), 0);
    assert.equal(parseDurationToSeconds(null), 0);
  });

  it('parseViewsCount handles EN & PT-BR suffixes and plain numbers', () => {
    assert.equal(parseViewsCount('1.2K views'), 1200);
    assert.equal(parseViewsCount('45M views'), 45_000_000);
    assert.equal(parseViewsCount('1.5B views'), 1_500_000_000);
    assert.equal(parseViewsCount('12 mil visualizações'), 12_000);
    assert.equal(parseViewsCount('3,4 mi de visualizações'), 3_400_000);
    assert.equal(parseViewsCount('2,5 bi visualizações'), 2_500_000_000);
    assert.equal(parseViewsCount('1.234 visualizações'), 1234);
    assert.equal(parseViewsCount('1,234 views'), 1234);
    assert.equal(parseViewsCount('No views'), 0);
    assert.equal(parseViewsCount('Nenhuma visualização'), 0);
    assert.equal(parseViewsCount(''), 0);
    assert.equal(parseViewsCount(null), 0);
  });

  it('extractVideoIdFromUrl extracts IDs from watch, shorts, and embed URLs', () => {
    assert.equal(extractVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s'), 'dQw4w9WgXcQ');
    assert.equal(extractVideoIdFromUrl('/shorts/abc123XYZ'), 'abc123XYZ');
    assert.equal(extractVideoIdFromUrl('https://www.youtube.com/embed/vid999'), 'vid999');
    assert.equal(extractVideoIdFromUrl('https://www.youtube.com/'), null);
    assert.equal(extractVideoIdFromUrl(''), null);
  });

  it('escapeHtml escapes all dangerous HTML characters', () => {
    assert.equal(
      escapeHtml(`<script>alert("x" & 'y')</script>`),
      '&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;'
    );
    assert.equal(escapeHtml(null), '');
  });
});

describe('Content Script & Brand Module Export Contracts', () => {
  it('src/shared/brand.js exports BRAND_NAME and BUY_ME_A_COFFEE_URL', () => {
    assert.equal(brandMod.BRAND_NAME, 'TubeNook');
    assert.equal(brandMod.BUY_ME_A_COFFEE_URL, 'https://buymeacoffee.com/aevren');
    assert.equal(typeof brandMod.DRIVE_BACKUP_FILENAME, 'string');
    assert.ok(brandMod.DRIVE_BACKUP_FILENAME.endsWith('.json'));
  });

  it('exports all required public functions across yt-dom, sidebar, subscriptions, playlists, courses, deck, and index', () => {
    assert.equal(typeof ytDomMod.getCurrentWatchVideoInfo, 'function');
    assert.equal(typeof ytDomMod.seekVideoPlayer, 'function');
    assert.equal(typeof ytDomMod.toggleFocusModeCss, 'function');

    assert.equal(typeof sidebarMod.initSidebar, 'function');
    assert.equal(typeof sidebarMod.refreshSidebar, 'function');

    assert.equal(typeof subsMod.initSubscriptions, 'function');
    assert.equal(typeof subsMod.onSubscriptionsNavigate, 'function');
    assert.equal(typeof subsMod.openManagerModal, 'function');
    assert.equal(typeof subsMod.openGroupFeed, 'function');
    assert.equal(typeof subsMod.refreshSubscriptionsUI, 'function');

    assert.equal(typeof playlistsMod.initPlaylists, 'function');
    assert.equal(typeof playlistsMod.onPlaylistsNavigate, 'function');
    assert.equal(typeof playlistsMod.openPlaylistGroupView, 'function');
    assert.equal(typeof playlistsMod.openCustomPlaylistView, 'function');
    assert.equal(typeof playlistsMod.openPlaylistCustomizeModal, 'function');
    assert.equal(typeof playlistsMod.refreshPlaylistsUI, 'function');
    assert.equal(typeof playlistsMod.handlePlaylistShortcut, 'function');

    assert.equal(typeof coursesMod.initCourses, 'function');
    assert.equal(typeof coursesMod.openCoursesModal, 'function');
    assert.equal(typeof coursesMod.openCoursePlayer, 'function');
    assert.equal(typeof coursesMod.openInsightsModal, 'function');
    assert.equal(typeof coursesMod.refreshCoursesUI, 'function');

    assert.equal(typeof deckMod.initDeck, 'function');
    assert.equal(typeof deckMod.openDeckModal, 'function');
    assert.equal(typeof deckMod.closeDeckModal, 'function');
    assert.equal(typeof deckMod.refreshDeck, 'function');

    assert.equal(typeof indexMod.boot, 'function');
  });
});

describe('Build Output (dist/) & Manifest V3 Asset Verification', () => {
  it('dist/manifest.json is valid MV3, branded TubeNook, has identity permission, and all referenced assets exist in dist/', () => {
    const manifestPath = path.join(DIST, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'dist/manifest.json missing (run npm run build)');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.name && manifest.version);
    assert.ok(manifest.name.includes('TubeNook'), `Expected manifest.name to include TubeNook, got: ${manifest.name}`);
    assert.ok(
      Array.isArray(manifest.permissions) && manifest.permissions.includes('identity'),
      'Expected manifest.permissions to include "identity"'
    );

    const referencedPaths = [
      ...Object.values(manifest.icons || {}),
      ...Object.values(manifest.action?.default_icon || {}),
      manifest.action?.default_popup,
      manifest.options_page,
      manifest.background?.service_worker,
      ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
    ].filter(Boolean);

    for (const relPath of referencedPaths) {
      const full = path.join(DIST, relPath);
      assert.ok(fs.existsSync(full), `Manifest asset missing in dist/: ${relPath}`);
      const stat = fs.statSync(full);
      assert.ok(stat.size > 0, `Manifest asset is empty in dist/: ${relPath}`);
    }

    // Verify PNG header on all icons
    for (const iconRel of Object.values(manifest.icons || {})) {
      const buf = fs.readFileSync(path.join(DIST, iconRel));
      assert.equal(buf[0], 0x89, `${iconRel} missing PNG magic byte`);
      assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${iconRel} is not a valid PNG`);
    }
  });

  it('every stylesheet referenced in src/content/index.js exists in dist/', () => {
    const indexSrc = fs.readFileSync(path.join(ROOT, 'src/content/index.js'), 'utf8');
    const cssRefs = [...indexSrc.matchAll(/['"](src\/content\/[^'"]+\.css)['"]/g)].map((m) => m[1]);
    assert.ok(cssRefs.length >= 4, `Expected >= 4 CSS refs in index.js, found ${cssRefs.length}`);

    for (const cssRel of cssRefs) {
      const full = path.join(DIST, cssRel);
      assert.ok(fs.existsSync(full), `Stylesheet referenced in index.js missing in dist/: ${cssRel}`);
      assert.ok(fs.statSync(full).size > 0, `Stylesheet is empty in dist/: ${cssRel}`);
    }
  });

  it('every script and stylesheet referenced in popup.html and options.html exists in dist/', () => {
    const htmlPages = ['src/popup/popup.html', 'src/options/options.html'];
    for (const pageRel of htmlPages) {
      const pageFull = path.join(DIST, pageRel);
      assert.ok(fs.existsSync(pageFull), `HTML page missing in dist/: ${pageRel}`);
      const html = fs.readFileSync(pageFull, 'utf8');
      const refs = [
        ...[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]),
        ...[...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((m) => m[1]),
      ].filter((r) => !r.startsWith('http'));

      assert.ok(refs.length >= 2, `Expected script & CSS refs in ${pageRel}`);
      for (const ref of refs) {
        const resolved = path.resolve(path.dirname(pageFull), ref);
        assert.ok(fs.existsSync(resolved), `Asset "${ref}" referenced in ${pageRel} missing in dist/`);
      }
    }
  });
});

describe('Brand, Chrome Web Store Assets & Hotsite Verification', () => {
  it('verifies assets/icons/logo.svg exists and is a valid SVG', () => {
    const logoPath = path.join(ROOT, 'assets/icons/logo.svg');
    assert.ok(fs.existsSync(logoPath), 'assets/icons/logo.svg missing');
    const svg = fs.readFileSync(logoPath, 'utf8');
    assert.ok(svg.includes('<svg'), 'assets/icons/logo.svg does not contain <svg');
    assert.ok(svg.includes('</svg>'), 'assets/icons/logo.svg missing closing </svg>');
  });

  it('verifies Chrome Web Store PNG assets exist and have valid PNG headers', () => {
    const pngFiles = [
      'store-assets/icon-128.png',
      'store-assets/promo-small-440x280.png',
      'store-assets/promo-marquee-1400x560.png',
    ];
    for (const rel of pngFiles) {
      const full = path.join(ROOT, rel);
      assert.ok(fs.existsSync(full), `Missing store asset: ${rel}`);
      const buf = fs.readFileSync(full);
      assert.ok(buf.length > 0, `Empty store asset: ${rel}`);
      assert.equal(buf[0], 0x89, `${rel} missing PNG magic byte`);
      assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${rel} is not a valid PNG`);
    }
  });

  it('verifies store-assets/STORE_LISTING.md and store-assets/PRIVACY_POLICY.md exist and are non-empty', () => {
    for (const rel of ['store-assets/STORE_LISTING.md', 'store-assets/PRIVACY_POLICY.md']) {
      const full = path.join(ROOT, rel);
      assert.ok(fs.existsSync(full), `Missing store document: ${rel}`);
      const content = fs.readFileSync(full, 'utf8').trim();
      assert.ok(content.length > 100, `Store document unexpectedly short: ${rel}`);
    }
  });

  it('verifies website/index.html contains dev@aevren.si, buymeacoffee.com/aevren, and all 4 language switches', () => {
    const htmlPath = path.join(ROOT, 'website/index.html');
    assert.ok(fs.existsSync(htmlPath), 'website/index.html missing');
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(html.includes('dev@aevren.si'), 'website/index.html missing dev@aevren.si');
    assert.ok(html.includes('buymeacoffee.com/aevren'), 'website/index.html missing buymeacoffee.com/aevren');

    for (const lang of ['pt-BR', 'pt-PT', 'en', 'es']) {
      assert.ok(
        html.includes(`data-lang="${lang}"`),
        `website/index.html missing language switch for ${lang}`
      );
    }
  });
});
