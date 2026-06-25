import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createAnalyzeReportHandler } from './netlify/functions/_shared/analyzeReport';

function localApiPlugin(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), '');
  const handler = createAnalyzeReportHandler((name) => env[name] || process.env[name]);

  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/analyze-report', async (req, res) => {
        const chunks: Buffer[] = [];

        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const request = new Request('http://localhost/api/analyze-report', {
              method: req.method,
              headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
              },
              body: Buffer.concat(chunks),
            });
            const response = await handler(request);
            const body = Buffer.from(await response.arrayBuffer());

            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(body);
          } catch (error) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : 'Local API failed.',
              }),
            );
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), localApiPlugin(mode)],
  build: {
    target: 'es2020',
  },
}));
