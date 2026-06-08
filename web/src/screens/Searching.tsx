import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import { apiPoll, apiLeaveQueue, apiStats, type StatsResponse } from "../lib/api";
import { plural } from "../lib/format";

export default function Searching() {
  const setScreen = useStore((s) => s.setScreen);
  const setCall = useStore((s) => s.setCall);
  const timer = useRef<number | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [waitSec, setWaitSec] = useState(0);

  useEffect(() => {
    let alive = true;

    // Тикалка ожидания, чтобы юзеру было видно сколько он стоит в очереди.
    const wt = window.setInterval(() => setWaitSec((s) => s + 1), 1000);

    // Дёргаем /stats раз в 5 секунд параллельно с поллом матчинга.
    const refreshStats = () => {
      apiStats()
        .then((s) => alive && setStats(s))
        .catch(() => {});
    };
    refreshStats();
    const st = window.setInterval(refreshStats, 5000);

    const tick = async () => {
      if (!alive) return;
      try {
        const r = await apiPoll();
        if (!alive) return;
        if (r.status === "matched" && r.token && r.ws_url && r.peer) {
          setCall({
            roomName: r.room_name!,
            token: r.token,
            wsUrl: r.ws_url,
            peerName: r.peer.first_name,
            peerFaculty: r.peer.faculty,
            peerCourse: r.peer.course,
            peerTgId: r.peer.tg_id,
            peerUsername: r.peer.username,
          });
          setScreen("call");
          return;
        }
      } catch (e) {
        // молча игнорим, попробуем снова
      }
      timer.current = window.setTimeout(tick, 1500);
    };

    timer.current = window.setTimeout(tick, 1500);

    return () => {
      alive = false;
      clearInterval(wt);
      clearInterval(st);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [setScreen, setCall]);

  const cancel = async () => {
    try {
      await apiLeaveQueue();
    } catch {}
    setScreen("home");
  };

  const hint = waitSec > 30
    ? "Народу сейчас мало — попробуй через пару минут или поделись ссылкой 👇"
    : "Обычно это занимает несколько секунд.";

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-accent/30 animate-ping" />
        <div className="relative w-32 h-32 rounded-full bg-accent/20 flex items-center justify-center text-5xl">
          🎙
        </div>
      </div>
      <div className="text-xl font-semibold">Ищем собеседника…</div>

      {stats && (
        <div className="text-sm text-muted text-center max-w-xs">
          <div>
            В очереди сейчас{" "}
            <span className="text-fg font-semibold">{stats.queue_size}</span>{" "}
            {plural(stats.queue_size, "человек", "человека", "человек")}
          </div>
          <div className="mt-1">
            За час прошло{" "}
            <span className="text-fg font-semibold">
              {stats.calls_last_hour}
            </span>{" "}
            {plural(stats.calls_last_hour, "звонок", "звонка", "звонков")}
          </div>
        </div>
      )}

      <div className="text-muted text-center max-w-xs text-sm">{hint}</div>

      <button
        onClick={cancel}
        className="mt-4 text-muted underline underline-offset-4"
      >
        Отмена
      </button>
    </div>
  );
}
