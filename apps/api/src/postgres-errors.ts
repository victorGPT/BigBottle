export function getPostgresErrorCode(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const cause = (err as any).cause;
  if (!cause || typeof cause !== 'object') return null;
  const code = (cause as any).code;
  return typeof code === 'string' ? code : null;
}

export function isUniqueViolation(err: unknown): boolean {
  return getPostgresErrorCode(err) === '23505';
}

