import type { IconName } from '../../components/Icon';
import type { RouteShare, Visibility } from '../../domain/types';

export const VISIBILITY_OPTIONS: { value: Visibility; label: string; icon: IconName }[] = [
  { value: 'private', label: 'Sadece ben', icon: 'lock' },
  { value: 'followers', label: 'Takipçiler', icon: 'users' },
  { value: 'public', label: 'Herkes', icon: 'globe' },
];

export const VISIBILITY_ICON: Record<Visibility, IconName> = { private: 'lock', followers: 'users', public: 'globe' };

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: 'Sadece ben',
  followers: 'Takipçiler',
  public: 'Herkes',
};

export function visibilitySentence(v: Visibility, share: RouteShare): string {
  if (v === 'private') return 'Sadece sen görebilirsin';
  const who = v === 'public' ? 'Herkes görebilir' : 'Takipçiler görebilir';
  const route = share === 'stats_only' ? 'Rota gizli' : share === 'full' ? 'Tüm rota görünür' : 'Başlangıç ve bitiş gizli';
  return `${who} · ${route}`;
}
