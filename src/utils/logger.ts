import { config } from '../config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function enabled(level: Level): boolean {
  return ORDER[level] >= (ORDER[(config.logLevel as Level) ?? 'info'] ?? 20);
}

function emit(level: Level, message: string, meta?: unknown): void {
  if (!enabled(level)) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (meta === undefined) fn(line);
  else fn(line, meta);
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
};
