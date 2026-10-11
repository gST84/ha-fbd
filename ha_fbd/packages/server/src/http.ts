import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listBlocks, type Program } from '@ha-fbd/engine';
import { checkShape, type WatchFrame } from './host.js';
import type { AutomationManager } from './manager.js';
import { ID_RE } from './store.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

/** HA Ingress always connects from the Supervisor proxy (172.30.32.2). */
export function isAllowedAddress(addr: string | undefined): boolean {
  const a = (addr ?? '').replace(/^::ffff:/, '');
  return a === '172.30.32.2' || a === '127.0.0.1' || a === '::1';
}

/** Export file: every automation's program in one JSON document (running state and retained variables are not included). */
export const EXPORT_FORMAT = 'ha-fbd-export';
export interface ExportFile { format: typeof EXPORT_FORMAT; version: 1; exported: string; automations: Program[] }

/** Accepts an export file or a single bare program; returns the programs or a message saying what is wrong. */
export function readImport(body: unknown): Program[] | string {
  const o = body as Partial<ExportFile> | null;
  const list = o && typeof o === 'object' && o.format === EXPORT_FORMAT ? o.automations : [body];
  if (!Array.isArray(list) || list.length === 0) return 'The file contains no automations';
  if (list.length > 200) return 'Too many automations in one file';
  for (const [i, p] of list.entries()) {
    const shape = checkShape(p);
    if (shape) return list.length > 1 ? `Automation ${i + 1}: ${shape}` : shape;
  }
  return list as Program[];
}

export interface ServerOptions { manager: AutomationManager; publicDir: string; ingressOnly?: boolean }

export function createHttpServer({ manager, publicDir, ingressOnly = false }: ServerOptions): http.Server {
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body === undefined ? 'null' : JSON.stringify(body));
  };
  const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
  const readBody = (req: http.IncomingMessage, limit = 5_000_000) => new Promise<unknown>((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(fail(413, 'Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(fail(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
  const compileErrors = (e: unknown) => [{ message: e instanceof Error ? e.message : String(e) }];

  async function serveStatic(urlPath: string, res: http.ServerResponse) {
    const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '') || 'index.html';
    let file = path.join(publicDir, rel);
    if (!file.startsWith(path.resolve(publicDir))) { res.writeHead(403).end(); return; }
    try {
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  }

  return http.createServer(async (req, res) => {
    try {
      if (ingressOnly && !isAllowedAddress(req.socket.remoteAddress)) { res.writeHead(403).end('Forbidden'); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const method = req.method ?? 'GET';
      const route = `${method} ${url.pathname}`;

      // ───────── global ─────────
      if (route === 'GET /api/status') {
        const list = manager.list();
        return send(res, 200, { ha: manager.ha.status, entities: manager.ha.listEntities().length,
          automations: { total: list.length, running: list.filter(a => a.running).length } });
      }
      if (route === 'GET /api/blocks') return send(res, 200, listBlocks());
      if (route === 'GET /api/areas') {
        try { return send(res, 200, { areas: await manager.ha.getAreas() }); }
        catch (e) { return send(res, 200, { areas: [], error: e instanceof Error ? e.message : String(e) }); }   // the editor falls back to typing the area id
      }
      if (route === 'GET /api/entities') {
        return send(res, 200, manager.ha.listEntities().map(e => ({
          entity_id: e.entity_id, state: e.state, name: (e.attributes.friendly_name as string | undefined) ?? e.entity_id,
        })));
      }

      // ───────── export / import ─────────
      if (route === 'GET /api/export') {
        const id = url.searchParams.get('id');
        if (id !== null && !ID_RE.test(id)) throw fail(400, 'Invalid automation id');
        const hosts = id === null ? manager.list().map(a => manager.get(a.id)) : [manager.get(id)];
        if (id !== null && !hosts[0]) throw fail(404, 'No such automation');
        const file: ExportFile = { format: EXPORT_FORMAT, version: 1, exported: new Date().toISOString(),
          automations: hosts.flatMap(h => (h?.program ? [h.program] : [])) };
        const name = id ?? `fbd-automations-${file.exported.slice(0, 10)}`;
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${name}.fbd.json"` });
        return res.end(JSON.stringify(file, null, 2));
      }
      if (route === 'POST /api/import') {
        const programs = readImport(await readBody(req));
        if (typeof programs === 'string') return send(res, 400, { error: programs });
        const imported: { id: string; name: string }[] = [];
        for (const p of programs) {                                   // always new automations, stopped; nothing is overwritten
          const host = await manager.create(typeof p.name === 'string' ? p.name : 'Imported automation', p);
          imported.push({ id: host.id, name: host.name });
        }
        return send(res, 201, { imported });
      }

      // ───────── automations ─────────
      if (route === 'GET /api/automations') return send(res, 200, manager.list());
      if (route === 'POST /api/automations') {
        const body = (await readBody(req)) as { name?: unknown };
        const host = await manager.create(typeof body.name === 'string' ? body.name : '');
        return send(res, 201, { id: host.id });
      }

      const m = /^\/api\/automations\/([^/]+)(?:\/([a-z]+))?$/.exec(url.pathname);
      if (m) {
        const [, id, action] = m;
        if (!ID_RE.test(id)) throw fail(400, 'Invalid automation id');
        const host = manager.get(id);
        if (!host) throw fail(404, 'No such automation');

        if (!action && method === 'GET') return send(res, 200, host.program);
        if (!action && method === 'DELETE') { await manager.remove(id); return send(res, 200, { ok: true }); }
        if (!action && method === 'PUT') {
          const body = await readBody(req);
          const shape = checkShape(body);
          if (shape) return send(res, 400, { ok: false, errors: [{ message: shape }] });
          await host.save(body as Program);
          const errors = host.validate(body);
          return send(res, 200, { ok: errors.length === 0, errors });
        }
        if (method === 'GET' && action === 'status') return send(res, 200, host.status());
        if (method === 'GET' && action === 'log') return send(res, 200, host.getLog());
        if (method === 'POST' && action === 'validate') {
          const errors = host.validate(await readBody(req));
          return send(res, 200, { ok: errors.length === 0, errors });
        }
        if (method === 'POST' && action === 'deploy') {
          const r = await host.deploy((await readBody(req)) as Program);
          return send(res, r.ok ? 200 : 422, r);
        }
        if (method === 'POST' && action === 'start') {
          try { host.start(); return send(res, 200, { ok: true }); } catch (e) { return send(res, 422, { ok: false, errors: compileErrors(e) }); }
        }
        if (method === 'POST' && action === 'stop') { await host.stop(); return send(res, 200, { ok: true }); }
        if (method === 'POST' && action === 'duplicate') {
          const copy = await manager.duplicate(id);
          return send(res, 201, { id: copy?.id });
        }
        if (method === 'GET' && action === 'watch') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          res.write(': connected\n\n');
          const onScan = (f: WatchFrame) => res.write(`data: ${JSON.stringify(f)}\n\n`);
          const beat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
          host.on('scan', onScan);
          req.on('close', () => { clearInterval(beat); host.off('scan', onScan); });
          return;
        }
        throw fail(404, 'Unknown API route');
      }

      if (url.pathname.startsWith('/api/')) throw fail(404, 'Unknown API route');
      if (method === 'GET' || method === 'HEAD') return await serveStatic(url.pathname, res);
      res.writeHead(405).end();
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) send(res, status, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    }
  });
}
