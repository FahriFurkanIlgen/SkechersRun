import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "../components/Icon";
import {
  Banner,
  Button,
  EmptyState,
  Loading,
  Screen,
  Txt,
} from "../components/ui";
import {
  ACTIVITY_LABEL,
  formatDistance,
  formatDuration,
} from "../domain/format";
import {
  connectStrava,
  disconnectStrava,
  fetchStravaStatus,
  importStravaActivity,
  listStravaActivities,
  stravaConfigured,
  type StravaActivity,
  type StravaStatus,
} from "../services/strava";
import { useAuth } from "../state/authStore";
import { useSettings } from "../state/settingsStore";
import { fonts, radius, useTheme } from "../theme/theme";

/**
 * Import Strava activities (e.g. recorded with a Garmin, Coros or Suunto that
 * syncs to Strava) with their route. They are validated like phone recordings.
 */
export default function ImportStrava() {
  const { colors } = useTheme();
  const units = useSettings((s) => s.units);
  const session = useAuth((s) => s.session);
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [activities, setActivities] = useState<StravaActivity[] | null>(null);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !stravaConfigured) return;
    try {
      setError(null);
      const s = await fetchStravaStatus();
      setStatus(s);
      if (!s.connected) return;
      const res = await listStravaActivities(1);
      setActivities(res.activities);
      setMore(res.more);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setActivities((a) => a ?? []);
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!session) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="lock"
          title="Önce giriş yap"
          message="Strava hesabını Runner hesabına bağlamak için giriş yapmalısın."
          action={{ label: "Giriş yap", onPress: () => router.push("/auth") }}
        />
      </Screen>
    );
  }
  if (!stravaConfigured) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="route"
          title="Strava henüz kullanılamıyor"
          message="Bu sürümde Strava bağlantısı ayarlanmamış."
        />
      </Screen>
    );
  }
  if (status === null) {
    return (
      <Screen edges={[]}>
        {error ? (
          <Banner tone="danger">{error}</Banner>
        ) : (
          <Loading label="Strava kontrol ediliyor" />
        )}
      </Screen>
    );
  }
  if (!status.connected) {
    return (
      <Screen edges={[]}>
        <EmptyState
          icon="route"
          title="Strava aktivitelerini getir"
          message="Garmin, Coros, Suunto ya da başka bir saatle kaydedip Strava’ya gönderdiğin yürüyüş, koşu ve bisiklet aktivitelerini rotasıyla içe aktar. İçe aktarılan aktivite de hücre kazandırır."
          action={{
            label: busy ? "Bağlanıyor…" : "Strava’ya bağlan",
            onPress: () =>
              void run("connect", async () => {
                if (await connectStrava()) await load();
              }),
          }}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Txt variant="caption" muted style={{ textAlign: "center" }}>
          Yalnızca aktivitelerin ve rotaları okunur; Strava’ya hiçbir şey
          yazılmaz. Bağlantıyı istediğin zaman buradan ya da Strava → Ayarlar →
          Uygulamalarım bölümünden kaldırabilirsin.
        </Txt>
      </Screen>
    );
  }

  return (
    <Screen edges={[]}>
      <Txt variant="bodySm" muted>
        {`${status.athleteName ? `${status.athleteName} olarak bağlı. ` : ""}İçe aktardığında rota ve süre aktivite özetine gelir; kaydedince sunucu tıpkı telefonla kayıt gibi doğrular ve hücreleri hesaplar.`}
      </Txt>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {activities === null ? (
        <Loading label="Aktiviteler getiriliyor" />
      ) : activities.length === 0 ? (
        <EmptyState
          icon="route"
          title="İçe aktarılacak aktivite yok"
          message="Strava’da GPS rotalı yürüyüş, koşu veya bisiklet aktivitesi bulunamadı."
        />
      ) : (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {activities.map((a, i) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityState={{
                disabled: a.alreadyImported,
                busy: busy === a.id,
              }}
              disabled={a.alreadyImported || busy !== null}
              onPress={() =>
                void run(a.id, async () => {
                  const id = await importStravaActivity(a.id);
                  router.replace({ pathname: "/summary/[id]", params: { id } });
                })
              }
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 14,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.border,
                opacity: a.alreadyImported ? 0.55 : 1,
              }}
            >
              <Icon
                name={a.type}
                size={26}
                color={colors.text}
                strokeWidth={1.9}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt
                  variant="body"
                  style={{ fontFamily: fonts.bodySemi }}
                  numberOfLines={1}
                >
                  {a.name || ACTIVITY_LABEL[a.type]}
                </Txt>
                <Txt variant="caption" muted>
                  {`${new Date(a.startedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "short" })} · ${formatDistance(a.distanceM, units)} · ${formatDuration(a.movingTimeS)}`}
                </Txt>
              </View>
              {a.alreadyImported ? (
                <Txt variant="caption" muted>
                  İçe aktarıldı
                </Txt>
              ) : (
                <Button
                  label="Aktar"
                  size="sm"
                  variant="tonal"
                  loading={busy === a.id}
                  onPress={() =>
                    void run(a.id, async () => {
                      const id = await importStravaActivity(a.id);
                      router.replace({
                        pathname: "/summary/[id]",
                        params: { id },
                      });
                    })
                  }
                />
              )}
            </Pressable>
          ))}
        </View>
      )}
      {more ? (
        <Button
          label="Daha eski aktiviteler"
          variant="secondary"
          loading={busy === "more"}
          onPress={() =>
            void run("more", async () => {
              const res = await listStravaActivities(page + 1);
              setActivities((list) => [...(list ?? []), ...res.activities]);
              setMore(res.more);
              setPage(page + 1);
            })
          }
        />
      ) : null}
      <Button
        label="Strava bağlantısını kaldır"
        variant="text"
        disabled={busy !== null}
        onPress={() =>
          void run("disconnect", async () => {
            await disconnectStrava();
            setActivities(null);
            setStatus({ connected: false, athleteName: null });
          })
        }
      />
    </Screen>
  );
}
