import { ValidationError } from './errors.js';

export function paramId(value: string | undefined, label = 'id'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new ValidationError(`Invalid ${label}`);
  return id;
}

export function requireString(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${label} is too long (max ${max})`);
  return trimmed;
}

export function optionalString(value: unknown, label: string, max = 5000): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new ValidationError(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${label} is too long (max ${max})`);
  return trimmed.length === 0 ? null : trimmed;
}

export function requireInt(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num) || !Number.isInteger(num)) {
    throw new ValidationError(`${label} must be a whole number`);
  }
  if (num < min || num > max)
    throw new ValidationError(`${label} must be between ${min} and ${max}`);
  return num;
}

export function optionalInt(
  value: unknown,
  label: string,
  min = -Infinity,
  max = Infinity,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requireInt(value, label, min, max);
}

export function requireNumber(
  value: unknown,
  label: string,
  min = -Infinity,
  max = Infinity,
): number {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    throw new ValidationError(`${label} must be a number`);
  }
  if (num < min || num > max)
    throw new ValidationError(`${label} must be between ${min} and ${max}`);
  return num;
}

export function optionalNumber(
  value: unknown,
  label: string,
  min = -Infinity,
  max = Infinity,
): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requireNumber(value, label, min, max);
}

export function requireCents(value: unknown, label: string): number {
  return requireInt(value, label, 0);
}

export function optionalCents(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  return requireCents(value, label);
}

export function requireBool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`${label} must be true or false`);
  return value;
}

export function optionalBool(value: unknown, label: string): boolean | null {
  if (value === undefined || value === null || value === '') return null;
  return requireBool(value, label);
}

export function requireEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T | null {
  if (value === undefined || value === null || value === '') return null;
  return requireEnum(value, label, allowed);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function requireDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new ValidationError(`${label} must be a date (YYYY-MM-DD)`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new ValidationError(`${label} is not a valid date`);
  return value;
}

export function optionalDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requireDate(value, label);
}

export function optionalId(value: unknown, label: string): number | null {
  return optionalInt(value, label, 1);
}

export function requireId(value: unknown, label: string): number {
  return requireInt(value, label, 1);
}
