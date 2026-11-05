import 'dotenv/config';

const PLACEHOLDER_SECRETS = new Set([
  'change-me',
  'change-me-to-a-long-random-string',
  'secret',
  'jwt-secret',
]);

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3280),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  dbPath: process.env.DB_PATH ?? 'data/vula-erp.db',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-vula-erp-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  appUrl: process.env.APP_URL ?? 'http://localhost:3280',
  demoMode: process.env.DEMO_MODE === 'true',
};

export function envProblems(): string[] {
  const problems: string[] = [];
  if (config.nodeEnv !== 'production') return problems;

  if (!process.env.JWT_SECRET || PLACEHOLDER_SECRETS.has(config.jwtSecret)) {
    problems.push('JWT_SECRET must be a strong, unique value in production');
  }
  if (!process.env.DB_PATH) problems.push('DB_PATH must be set in production');
  if (!process.env.APP_URL) problems.push('APP_URL must be set in production');
  if (process.env.APP_URL?.includes('localhost') && process.env.ALLOW_LOCAL_APP_URL !== 'true') {
    problems.push(
      'APP_URL must not point at localhost in production (set ALLOW_LOCAL_APP_URL=true to override)',
    );
  }
  return problems;
}

export function assertEnv(): void {
  const problems = envProblems();
  if (problems.length > 0) {
    throw new Error(`Invalid environment:\n- ${problems.join('\n- ')}`);
  }
}
