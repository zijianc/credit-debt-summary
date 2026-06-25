import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAnalyzeReportHandler } from './netlify/functions/_shared/analyzeReport';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 3000);

async function loadDotEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;

  const content = await readFile(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;

    const key = line.slice(0, index).trim();
    const rawValue = line.slice(index + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, '');
    process.env[key] ||= value;
  }
}

function mimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function setSecurityHeaders(headers: Record<string, string> = {}) {
  return {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    ...headers,
  };
}

async function requestFromIncoming(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return new Request(`http://localhost${req.url || '/'}`, {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
    },
    body: Buffer.concat(chunks),
  });
}

function safeStaticPath(urlPath: string) {
  const pathname = decodeURIComponent(urlPath.split('?')[0] || '/');
  const requested = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(distDir, requested));
  if (!resolved.startsWith(distDir)) return path.join(distDir, 'index.html');
  return existsSync(resolved) ? resolved : path.join(distDir, 'index.html');
}

await loadDotEnv();
const analyzeReport = createAnalyzeReportHandler((name) => process.env[name]);

const server = createServer(async (req, res) => {
  try {
    if (req.url?.startsWith('/api/analyze-report')) {
      const response = await analyzeReport(await requestFromIncoming(req));
      const body = Buffer.from(await response.arrayBuffer());

      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(body);
      return;
    }

    const filePath = safeStaticPath(req.url || '/');
    res.writeHead(200, setSecurityHeaders({ 'Content-Type': mimeType(filePath) }));
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, setSecurityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Server error.',
      }),
    );
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Credit debt summary server listening on http://0.0.0.0:${port}`);
});
