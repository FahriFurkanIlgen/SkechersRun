/**
 * iOS reports kCLErrorLocationUnknown (code 0) while it briefly has no fix,
 * e.g. in tunnels; it recovers by itself, so it is not shown. Others get a
 * readable message instead of the raw CoreLocation/Android error.
 */
export function trackingErrorMessage(raw: string): string | null {
  if (/kCLErrorDomain Code=0\b/.test(raw)) return null;
  if (/kCLErrorDomain Code=1\b/.test(raw) || /permission/i.test(raw)) {
    return 'Konum izni kapatıldı. Kaydın devam etmesi için Ayarlar’dan konum iznini aç.';
  }
  return `Konum alınamıyor (${raw}). Kayıt, konum geldiğinde devam eder.`;
}
