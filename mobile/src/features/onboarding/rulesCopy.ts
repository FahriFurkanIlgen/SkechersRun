import { RULES } from '../../domain/rules';

/** Plain-language explanation of the territory rules, shared by onboarding and help. */
export const RULE_SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Hareket et, rotan kaydedilsin',
    body: 'Yürüyüş, koşu veya bisiklet: hepsi aynı şekilde sayılır. Rotan GPS ile kaydedilir.',
  },
  {
    title: 'Rotan bölgeye dönüşür',
    body:
      'Harita altıgen hücrelere bölünmüştür. ' +
      `İçinden en az ${RULES.minCellPathM} m geçtiğin her hücre senin olur. ` +
      `Başladığın yere ${RULES.loopCloseDistanceM} m yakında bitirirsen çevrelediğin hücreler de senin olur.`,
  },
  {
    title: 'Adil oyun kuralları',
    body:
      `Bölge için en az ${RULES.minClaimDistanceM} m gerekir. Aynı rotayı tekrarlamak yeni hücre kazandırmaz; ` +
      'yalnızca henüz senin olmayan hücreler sayılır. Başka bir oyuncunun hücresinden geçersen onu ele geçirirsin.',
  },
  {
    title: 'Bölgeni savun',
    body:
      'Hücrelerinden ara sıra geçmen yeterli. 3 hafta uğramadığın hücreler zayıflar (haritada soluk görünür), ' +
      '6 haftayı doldurursa boşalır. Yeni aldığın hücreler 12 saat korunur; bu sürede kimse geri alamaz.',
  },
  {
    title: 'Sezonlar, kaleler ve takımlar',
    body:
      'Her ay yeni bir sezon başlar. Kazandığın ve aldığın hücreler sezon puanı verir; park ve sahil gibi kalelerin her biri ' +
      '+5 puan. Puanınla Çaylak’tan Efsane’ye yükselirsin. İlçe takımını seçersen haftalık kazancın ilçenin puanına, ' +
      'kulübündeysen kulübün puanına da eklenir.',
  },
  {
    title: 'Sunucu karar verir',
    body:
      'Hücreler ve sahiplik sunucuda hesaplanır. Sahte konum, imkânsız hızlar, konum sıçramaları ve tekrar yüklenen ' +
      'rotalar reddedilir. Uygulamadaki hücre sayısı sunucu onayına kadar bir tahmindir.',
  },
  {
    title: 'Gizliliğin senin elinde',
    body:
      `Paylaşılan rotalarda başlangıç ve bitişin ilk ${RULES.publicRouteTrimM} m'si her zaman gizlenir. ` +
      'Ev ve iş gibi gizlilik alanları ekleyebilir, aktivitelerini yalnızca takipçilerine veya yalnızca kendine açabilirsin.',
  },
];
