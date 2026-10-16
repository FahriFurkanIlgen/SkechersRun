import { REASON_LABEL } from '../../data/remote/activityApi';
import { formatDistance } from '../../domain/format';
import { RULES } from '../../domain/rules';
import type { ClaimEstimate } from '../../domain/territory';
import type { Activity, UnitSystem } from '../../domain/types';

/** Explains how the device estimate was derived, in the user's units. */
export function estimateExplanation(e: ClaimEstimate, units: UnitSystem): string {
  if (e.shape === 'too_short') {
    return `Hücre kazanmak için en az ${formatDistance(RULES.minClaimDistanceM, units)} gerekiyor; bu hareketin yine de haftalık hedefine ve serine sayıldı.`;
  }
  if (e.shape === 'loop') {
    return 'Rota başladığın yere yakın bitti: geçtiğin ve çevrelediğin hücreler sayılır.';
  }
  return (
    `Açık rota: içinden en az ${RULES.minCellPathM} m geçtiğin hücreler sayılır. ` +
    `Başlangıca ${formatDistance(RULES.loopCloseDistanceM, units)} yakında bitirseydin çevrelediğin hücreler de sayılırdı ` +
    `(bitiş noktan ${formatDistance(e.closureGapM, units)} uzaktaydı).`
  );
}

export function syncStateText(a: Activity): string {
  switch (a.syncState) {
    case 'local_only':
      return 'Yalnızca bu cihazda. Hücre kazanmak için giriş yapıp sunucuya yüklemelisin.';
    case 'pending_upload':
      return a.lastSyncError
        ? `Yükleme bekliyor (son hata: ${a.lastSyncError}). Bağlantı gelince tekrar denenecek.`
        : 'Sunucuya yükleme bekliyor.';
    case 'uploaded':
      return 'Sunucu tarafından doğrulandı.';
    case 'rejected':
      return 'Sunucu doğrulaması başarısız oldu; hücre verilmedi.';
  }
}

export function reasonTexts(reasons: string[]): string[] {
  return reasons.map((r) => REASON_LABEL[r] ?? r);
}
