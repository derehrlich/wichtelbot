// HTTP-Schicht: Routen, Cookies, Schutz vor zu vielen Anfragen, statische Dateien.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { UserError } from './service.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const COOKIE = 'wichtel_session';
const PAGES = { '/': 'index.html', '/anmelden': 'anmelden.html' };

function limiter(max, windowMs, nowFn) {
  const hits = new Map();
  return (key) => {
    const t = nowFn();
    const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    list.push(t);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k);
    return list.length <= max;
  };
}

export function createApp({ service, publicDir, siteUrl, nowMs = () => Date.now() }) {
  const secure = siteUrl.startsWith('https://');
  const root = resolve(publicDir);
  // Versionsnummer aus dem Inhalt der Oberflächen-Dateien. Die Seiten verweisen auf app.js?v=<Nummer>,
  // dadurch laden Browser und Cloudflare nach jedem Update automatisch die neue Datei.
  const assetVersion = createHash('sha1')
    .update(readdirSync(root).filter((f) => /\.(js|css|html)$/.test(f)).sort().map((f) => f + readFileSync(join(root, f))).join('\0'))
    .digest('hex').slice(0, 10);
  const loginLimit = limiter(8, 10 * 60_000, nowMs);
  const tokenLimit = limiter(60, 10 * 60_000, nowMs);

  const clientIp = (req) => req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
  const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s).slice(0, 2)).filter(([k]) => k));

  const baseHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'",
  };

  function sendJson(res, status, body, extra = {}) {
    res.writeHead(status, { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  }

  async function readJson(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new UserError('Ungültige Anfrage', 415);
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new UserError('Anfrage zu groß', 413);
      chunks.push(c);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new UserError('Ungültige Anfrage'); }
  }

  const sessionCookie = (value, maxAge) =>
    `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

  async function api(req, res, url) {
    const method = req.method;
    const path = url.pathname;
    const ip = clientIp(req);
    const sessionToken = cookies(req)[COOKIE];
    const user = service.userFromSession(sessionToken);
    const needUser = () => { if (!user) throw new UserError('Bitte melde dich an.', 401); return user; };
    const needAdmin = () => { if (!service.isAdmin(needUser())) throw new UserError('Dafür fehlt die Berechtigung.', 403); };

    // --- öffentlich ---
    if (method === 'POST' && path === '/api/login') {
      if (!loginLimit(ip)) throw new UserError('Zu viele Versuche. Bitte warte ein paar Minuten.', 429);
      const body = await readJson(req);
      await service.requestLogin(body.email).catch((e) => console.error('Login-Mail:', e.message));
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'POST' && path === '/api/auth/verify') {
      if (!loginLimit(ip)) throw new UserError('Zu viele Versuche. Bitte warte ein paar Minuten.', 429);
      const body = await readJson(req);
      const s = service.consumeLoginToken(body.token);
      if (!s) throw new UserError('Der Link ist abgelaufen oder wurde schon benutzt. Fordere bitte einen neuen an.', 400);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(s.session, s.maxAgeSeconds) });
    }
    if (method === 'POST' && path === '/api/logout') {
      service.logout(sessionToken);
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }
    const wichtel = path.match(/^\/api\/wichtel\/([A-Za-z0-9_-]{20,80})$/);
    if (method === 'GET' && wichtel) {
      if (!tokenLimit(ip)) throw new UserError('Zu viele Anfragen.', 429);
      const w = service.wichtelByToken(wichtel[1]);
      if (!w) throw new UserError('Diesen Link gibt es nicht (mehr).', 404);
      return sendJson(res, 200, w);
    }

    // --- angemeldet ---
    if (method === 'GET' && path === '/api/me') return sendJson(res, 200, service.meState(needUser()));
    if (method === 'PUT' && path === '/api/me') {
      const u = needUser();
      const b = await readJson(req);
      return sendJson(res, 200, service.updateProfile(u.id, { name: b.name, wishes: b.wishes, noGos: b.noGos }));
    }
    if (method === 'POST' && path === '/api/me/resend') {
      await service.resendMyAssignment(needUser().id);
      return sendJson(res, 200, { ok: true });
    }

    // --- Organisator ---
    if (path.startsWith('/api/admin/')) {
      needAdmin();
      if (method === 'GET' && path === '/api/admin/state') return sendJson(res, 200, service.adminState());
      if (method === 'POST' && path === '/api/admin/users') {
        const b = await readJson(req);
        return sendJson(res, 201, await service.addUser(b));
      }
      const one = path.match(/^\/api\/admin\/users\/(\d+)(\/invite|\/resend-draw)?$/);
      if (one) {
        const id = Number(one[1]);
        if (method === 'POST' && one[2] === '/invite') { await service.inviteAgain(id); return sendJson(res, 200, { ok: true }); }
        if (method === 'POST' && one[2] === '/resend-draw') { await service.resendAssignmentTo(id); return sendJson(res, 200, { ok: true }); }
        if (method === 'PATCH' && !one[2]) {
          const b = await readJson(req);
          return sendJson(res, 200, service.adminUpdateUser(id, { name: b.name, email: b.email, active: b.active, wishes: b.wishes, noGos: b.noGos }));
        }
        if (method === 'DELETE' && !one[2]) { service.deleteUser(id); return sendJson(res, 200, { ok: true }); }
      }
      if (method === 'POST' && path === '/api/admin/exclusions') {
        const b = await readJson(req);
        service.addExclusion(b.a, b.b);
        return sendJson(res, 201, { ok: true });
      }
      const ex = path.match(/^\/api\/admin\/exclusions\/(\d+)\/(\d+)$/);
      if (method === 'DELETE' && ex) { service.removeExclusion(ex[1], ex[2]); return sendJson(res, 200, { ok: true }); }
      if (method === 'PUT' && path === '/api/admin/reminders') {
        return sendJson(res, 200, service.setReminders(await readJson(req)));
      }
      if (method === 'POST' && path === '/api/admin/reset') {
        const b = await readJson(req);
        if (b.confirm !== 'ZURUECKSETZEN') throw new UserError('Bitte den Reset bestätigen.');
        return sendJson(res, 200, service.resetAll());
      }
      if (method === 'POST' && path === '/api/admin/draw') {
        const b = await readJson(req);
        return sendJson(res, 200, await service.runDraw({ redo: b.redo === true }));
      }
    }
    throw new UserError('Nicht gefunden', 404);
  }

  async function serveStatic(res, rel, query = '', status = 200) {
    const file = normalize(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return sendJson(res, 404, { error: 'Nicht gefunden' });
    try {
      let data = await readFile(file);
      const ext = extname(file);
      const type = MIME[ext] || 'application/octet-stream';
      let cache;
      if (ext === '.html') {
        data = Buffer.from(data.toString('utf8').replaceAll('{{V}}', assetVersion));
        cache = 'no-store';
      } else if (/\.(js|css)$/.test(ext)) {
        // Mit der richtigen Versionsnummer darf es lange gespeichert werden, ohne sie nie.
        cache = query === `v=${assetVersion}` ? 'public, max-age=31536000, immutable' : 'no-store';
      } else {
        cache = /\.(woff2|png|jpg)$/.test(ext) ? 'public, max-age=86400' : 'no-cache';
      }
      res.writeHead(status, { ...baseHeaders, 'Content-Type': type, 'Cache-Control': cache });
      res.end(data);
    } catch {
      res.writeHead(404, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Nicht gefunden');
    }
  }

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Nicht erlaubt' });
      if (PAGES[url.pathname]) return await serveStatic(res, PAGES[url.pathname]);
      if (/^\/wichtel\/[A-Za-z0-9_-]+$/.test(url.pathname)) return await serveStatic(res, 'wichtel.html');
      return await serveStatic(res, decodeURIComponent(url.pathname).replace(/^\/+/, ''), url.search.replace(/^\?/, ''));
    } catch (e) {
      if (e instanceof UserError) return sendJson(res, e.status, { error: e.message });
      console.error(e);
      sendJson(res, 500, { error: 'Da ist etwas schiefgelaufen. Bitte versuche es später noch einmal.' });
    }
  };

  return { handler, listen: (port) => createServer(handler).listen(port) };
}
