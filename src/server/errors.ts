// Error types shared by services, actions and route handlers.
// Kept free of Next.js imports so services can also run in CLI scripts and tests.

export class AccessDeniedError extends Error {
  constructor(public reason: 'unauthenticated' | 'not_member' | 'forbidden' | 'suspended' | 'location') {
    super(`access_denied:${reason}`);
  }
}

/** An error whose `code` is safe to show to the user. */
export class UserFacingError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(code);
  }
}
