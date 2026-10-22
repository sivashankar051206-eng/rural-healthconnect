export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

export const badRequest = (code = 'BAD_REQUEST', message = 'Invalid request.', details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (code = 'UNAUTHENTICATED', message = 'Please log in.') => new HttpError(401, code, message);
export const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission to do this.') =>
  new HttpError(403, code, message);
export const notFound = (code = 'NOT_FOUND', message = 'Not found.') => new HttpError(404, code, message);
export const conflict = (code = 'CONFLICT', message = 'This action conflicts with the current state.') =>
  new HttpError(409, code, message);
export const unprocessable = (code = 'UNPROCESSABLE', message = 'This request could not be processed.') =>
  new HttpError(422, code, message);
