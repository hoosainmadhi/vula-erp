export class HttpError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message, 'validation_error');
    this.name = 'ValidationError';
  }
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, message, 'not_found');
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message, 'conflict');
}
