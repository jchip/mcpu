/**
 * Safely extract error message from unknown error type
 * Use this instead of `catch (error: any)` pattern
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

/**
 * Type guard to check if error is a Node.js system error with a code property
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Check if error has a specific Node.js error code
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return isNodeError(error) && error.code === code;
}
