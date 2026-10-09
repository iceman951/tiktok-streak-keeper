export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'SECURITY_CHALLENGE'
  | 'UI_CHANGED'
  | 'IDENTITY_MISMATCH'
  | 'TRANSIENT_NAVIGATION'
  | 'SEND_UNCERTAIN'
  | 'DAY_CHANGED'
  | 'LOCKED'
  | 'UNEXPECTED';

export class AppError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
    this.name = 'AppError';
  }
}

// Raw browser errors can contain DOM text, URLs, or session information. Never log them.
export function errorCode(error: unknown): ErrorCode {
  return error instanceof AppError ? error.code : 'UNEXPECTED';
}

export function fatalForRun(error: unknown): boolean {
  return !['TRANSIENT_NAVIGATION', 'DAY_CHANGED'].includes(errorCode(error));
}
