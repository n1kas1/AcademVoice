import { useEffect, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { useStore } from "../lib/store";
import { apiCallResult, apiAllowPm } from "../lib/api";
import { plural } from "../lib/format";

// Разрешение боту писать спрашиваем максимум раз за загрузку приложения.
let writeAccessAsked = false;

export default function AfterCall() {
  const call = useStore((s) => s.call);
  const setCall = useStore((s) => s.setCall);
  const setScreen = useStore((s) => s.setScreen);
  const profile = useStore((s) => s.profile);
  const patchProfile = useStore((s) => s.patchProfile);

  const [mutualUsername, setMutualUsername] = useState<string | undefined>(
    call?.mutual ? call.mutualUsername : undefined
  );
  const [checked, setChecked] = useState(!!call?.mutual);

  // Если собеседник нажал сердечко уже после нас — узнаём об этом тут.
  useEffect(() => {
    if (!call) return;
    if (checked) return;
    apiCallResult(call.roomName)
      .then((r) => {
        if (r.mutual && r.peer_username) {
          setMutualUsername(r.peer_username);
          setCall({ ...call, mutual: true, mutualUsername: r.peer_username });
        }
      })
      .catch(() => {})
      .finally(() => setChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // После звонка деликатно просим разрешение боту писать — чтобы уведомить
  // о взаимной симпатии, если собеседник ответит сердечком позже. Раз за сессию.
  useEffect(() => {
    if (writeAccessAsked || profile?.allowPm) return;
    const wa = WebApp as unknown as {
      requestWriteAccess?: (cb: (granted: boolean) => void) => void;
    };
    if (typeof wa.requestWriteAccess !== "function") return;
    const t = setTimeout(() => {
      // Флаг ставим в момент реального показа промпта (а не на монтировании):
      // иначе быстрый уход «Следующий» до 1200мс съел бы единственную попытку за сессию.
      writeAccessAsked = true;
      wa.requestWriteAccess!((granted) => {
        if (granted) {
          // allowPm локально — только после успешного сохранения на бэке,
          // иначе фронт/бэк рассинхронятся и mutual-push не уйдёт.
          apiAllowPm()
            .then(() => patchProfile({ allowPm: true }))
            .catch(() => {});
        }
      });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!call) {
    setScreen("home");
    return null;
  }

  const back = () => {
    setCall(null);
    setScreen("home");
  };

  const streak = profile?.streak ?? 0;
  // Короткий звонок без взаимности — подбадриваем, а не «не совпало».
  const isTooShort = !mutualUsername && (call.callDurationSecs ?? 99) < 15;

  return (
    <div className="flex-1 flex flex-col p-6 gap-6">
      {mutualUsername ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-6xl">💞</div>
          <div className="text-2xl font-semibold">Взаимно!</div>
          <div className="text-muted max-w-xs">
            Вы оба отправили сердечко. {call.peerName} ждёт твоего сообщения.
          </div>
          <a
            href={`https://t.me/${mutualUsername}`}
            className="mt-4 bg-accent text-white rounded-2xl px-6 py-3 font-semibold"
          >
            Написать @{mutualUsername}
          </a>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-5xl">{isTooShort ? "🙂" : "👋"}</div>
          <div className="text-xl font-semibold">
            {isTooShort ? "Коротко вышло" : "Разговор завершён"}
          </div>
          <div className="text-muted max-w-xs">
            {!checked
              ? "Проверяем результаты…"
              : isTooShort
              ? "Бывает! Следующий собеседник может оказаться куда интереснее."
              : "В этот раз не совпало. Найдём ещё кого-нибудь?"}
          </div>
        </div>
      )}

      {streak > 1 && (
        <div className="text-center text-sm text-muted">
          🔥 {streak} {plural(streak, "день", "дня", "дней")} подряд
        </div>
      )}

      <button
        onClick={back}
        className="bg-accent text-white rounded-2xl py-4 font-semibold"
      >
        Следующий собеседник
      </button>
    </div>
  );
}
