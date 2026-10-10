const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

/** Lowercases, maps Turkish letters to ASCII and drops characters a username cannot contain. */
export function normalizeUsername(input: string): string {
  return input
    .toLocaleLowerCase('tr-TR')
    // ç ğ ö ş ü → base letter (also handles decomposed input), dotless ı → i
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 24);
}

export function validateUsername(name: string): string | null {
  return USERNAME_RE.test(name) ? null : '3-24 karakter; küçük harf, rakam, alt çizgi veya nokta kullan.';
}
