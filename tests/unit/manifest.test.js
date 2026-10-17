'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const core = require('../../lib/core.js');
const serviceWorkerSource = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');

test('manifest is MV3, versioned and uses a minimal permission set', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '3.2.0');
  assert.equal(manifest.name, 'Odesoftami QA Monitor');
  assert.equal(manifest.short_name, 'QA Monitor');
  assert.equal(manifest.description, 'Browser QA & Monitoring Tool');
  assert.equal(manifest.author, undefined, 'author is not a supported Chrome manifest key');
  assert.deepEqual(manifest.permissions.slice().sort(), [
    'activeTab', 'alarms', 'notifications', 'scripting', 'storage', 'webRequest'
  ].sort());
  assert.equal(manifest.permissions.includes('webRequestBlocking'), false);
  assert.equal(manifest.permissions.includes('tabs'), false);
  assert.equal(manifest.permissions.includes('downloads'), false);
  assert.equal(manifest.permissions.includes('unlimitedStorage'), false);
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.background.service_worker, 'service-worker.js');
  assert.equal(manifest.action.default_popup, undefined, 'action uses onClicked detached window, not an anchored popup');
  assert.match(serviceWorkerSource, /chrome\.action\.onClicked/);
  assert.match(serviceWorkerSource, /chrome\.windows\.create/);
  assert.equal(core.GITHUB_URL, 'https://github.com/odesoftami');
  assert.equal(core.WEBSITE_URL, 'https://odesoftami.com/apk');
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.content_scripts[0].all_frames, false);
  assert.deepEqual(manifest.content_scripts[0].js, ['refresh-content.js', 'panel-content.js']);
  assert.equal(JSON.stringify(manifest).includes('webRequestBlocking'), false);
});

test('all files referenced by the manifest exist', () => {
  const refs = new Set([
    manifest.background.service_worker,
    'popup.html',
    manifest.options_page,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((entry) => entry.js || [])
  ]);
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, ref)), 'missing referenced file: ' + ref);
  }
});

test('extension source contains no remote code or unsafe evaluation', () => {
  const files = [
    'service-worker.js', 'refresh-content.js', 'popup.js', 'options.js', 'dashboard.js',
    'lib/core.js', 'lib/engine.js', 'lib/screenshots.js'
  ];
  const forbidden = [/new\s+Function\s*\(/, /\beval\s*\(/, /document\.write\s*\(/, /chrome\.scripting\.executeScript\s*\(\s*\{\s*code\s*:/];
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, file + ' contains forbidden pattern ' + pattern);
    }
    assert.equal(/https?:\/\/[^'"\s]+\/[^'"\s]*\.js/.test(source), false, file + ' appears to reference remote JavaScript');
  }
});

test('HTML pages do not use inline scripts or inline event handlers', () => {
  for (const file of ['popup.html', 'options.html', 'dashboard.html', 'privacy.html']) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, file + ' has an inline script');
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, file + ' has an inline event handler');
  }
});
