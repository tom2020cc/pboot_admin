export function jwtSecret(value: string | undefined, production: boolean): string {
  const secret = value?.trim();
  if (production && (!secret || secret.length < 32)) {
    throw new Error('Production requires a unique JWT_SECRET of at least 32 characters.');
  }
  // Preserve existing local sessions; production never uses this fallback.
  return secret || 'hahaha';
}
