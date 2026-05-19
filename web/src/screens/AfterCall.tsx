import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { apiCallResult } from "../lib/api";

export default function AfterCall() {
  const call = useStore((s) => s.call);
  const setCall = useStore((s) => s.setCall);
  const setScreen = useStore((s) => s.setScreen);

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

  if (!call) {
    setScreen("home");
    return null;
  }

  const back = () => {
    setCall(null);
    setScreen("home");
  };

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
          <div className="text-5xl">👋</div>
          <div className="text-xl font-semibold">Разговор завершён</div>
          <div className="text-muted max-w-xs">
            {checked
              ? "В этот раз не совпало. Найдём ещё кого-нибудь?"
              : "Проверяем результаты…"}
          </div>
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
