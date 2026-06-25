import type { Config, Context } from '@netlify/functions';

import { createAnalyzeReportHandler } from './_shared/analyzeReport';

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

const handler = createAnalyzeReportHandler((name) => Netlify.env.get(name));

export default async (req: Request, _context: Context) => {
  return handler(req);
};

export const config: Config = {
  path: '/api/analyze-report',
  method: ['POST'],
};
