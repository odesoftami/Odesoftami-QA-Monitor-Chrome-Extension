'use strict';

const http = require('node:http');

function htmlPage(title, body, head = '') {
  const style = '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;max-width:760px;margin:48px auto;padding:0 24px;color:#202633;background:#f7f9fc;line-height:1.55}h1{font-size:34px;margin:0 0 12px}.status-message{display:inline-block;background:#e8f7ef;color:#147a48;border-radius:8px;padding:6px 10px;font-weight:700}p{color:#596273}</style>';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>' + title + '</title>' + style + head +
    '</head><body>' + body + '</body></html>';
}

const BASE_BODY = '<h1 id="title">READY</h1><div class="status-message">OK</div><p id="note">Stable content</p>';
const DYNAMIC_SCRIPT = '<script>setTimeout(function(){var p=document.createElement("p");p.id="late";p.textContent="DYNAMIC TEXT";document.body.appendChild(p);var d=document.createElement("div");d.className="late-element";d.textContent="LATE ELEMENT";document.body.appendChild(d);},4000);</script>';
const SPA_SCRIPT = '<script>function pushRoute(){history.pushState({route:"2"},"","/spa?route=2");}</script>';

async function startServer() {
  const counts = Object.create(null);
  const openResponses = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    counts[pathname] = (counts[pathname] || 0) + 1;
    const send = (status, body, headers) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(headers || {})
      });
      res.end(body);
    };
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (pathname === '/never') {
      openResponses.add(res);
      return;
    }
    if (pathname === '/ok') return send(200, htmlPage('OK', BASE_BODY));
    if (pathname === '/') return send(200, htmlPage('Fixture home', BASE_BODY));
    if (pathname === '/dynamic') return send(200, htmlPage('Dynamic', BASE_BODY, DYNAMIC_SCRIPT));
    if (pathname === '/spa') return send(200, htmlPage('SPA', BASE_BODY, SPA_SCRIPT));
    if (pathname === '/slow') {
      setTimeout(() => send(200, htmlPage('Slow', BASE_BODY)), 800);
      return;
    }
    if (pathname === '/hang') {
      return send(200, htmlPage('Hang', BASE_BODY + '<img src="/never" alt="never">'));
    }
    if (pathname === '/missing') return send(404, htmlPage('Missing', '<h1 id="title">NOT FOUND</h1><div class="status-message">404</div>'));
    if (pathname === '/forbidden') return send(403, htmlPage('Forbidden', '<h1 id="title">FORBIDDEN</h1><div class="status-message">403</div>'));
    if (pathname === '/error') return send(500, htmlPage('Error', '<h1 id="title">ERROR</h1><div class="status-message">500</div>'));
    if (pathname === '/redirect') {
      res.writeHead(302, { Location: '/ok?redirected=1', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    if (pathname === '/plain') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('READY plain text');
      return;
    }
    return send(404, htmlPage('Not found', '<h1>UNKNOWN ROUTE</h1>'));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    url: 'http://127.0.0.1:' + port,
    counts,
    resetCounts() {
      for (const key of Object.keys(counts)) delete counts[key];
    },
    async close() {
      for (const res of openResponses) {
        try { res.destroy(); } catch (_) { /* ignore */ }
      }
      openResponses.clear();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

module.exports = { startServer };
