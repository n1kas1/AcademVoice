import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { apiJoinQueue, apiStats, type StatsResponse } from "../lib/api";
import { plural } from "../lib/format";
import WebApp from "@twa-dev/sdk";
import Footer from "../components/Footer";

export default function Home() {
  const profile = useStore((s) => s.profile);
  const setScreen = useStore((s) => s.setScreen);
  const setCall = useStore((s) => s.setCall);
  const [stats, setStats] = useState<StatsResponse | null>(null);

  useEffect(() => {
    apiStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const onFind = async () => {
    setScreen("searching");
    try {
      const r = await apiJoinQueue();
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
      }
      // если queued — Searching экран сам начнёт поллить
    } catch (e) {
      WebApp.showAlert("Не получилось встать в очередь. Попробуй ещё раз.");
      setScreen("home");
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 gap-6">
      <div>
        <div className="text-xl font-semibold">Академ.voice</div>
        <div className="text-muted text-sm mt-1">
          {profile?.faculty} · {profile?.course}
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <div className="text-7xl">🎙</div>
        <div className="text-center text-muted max-w-xs">
          Жми — мы найдём собеседника из Академии и соединим вас по голосу.
        </div>
        {stats &&
          (stats.queue_size > 0 ? (
            <div className="text-sm text-center text-muted">
              Сейчас в очереди{" "}
              <span className="text-fg font-semibold">{stats.queue_size}</span>{" "}
              {plural(stats.queue_size, "человек", "человека", "человек")} · за час{" "}
              <span className="text-fg font-semibold">{stats.calls_last_hour}</span>{" "}
              {plural(stats.calls_last_hour, "звонок", "звонка", "звонков")}
            </div>
          ) : (
            <div className="text-sm text-center text-muted">
              Будь первым — мы позовём, как только кто-то зайдёт 🔔
            </div>
          ))}
        <button
          onClick={onFind}
          className="bg-accent text-white rounded-full px-10 py-5 text-lg font-semibold shadow-lg active:scale-95 transition"
        >
          Найти собеседника
        </button>
      </div>

      <div className="text-xs text-muted text-center">
        Правила: будь вежлив, не записывай разговор, не вытаскивай личных данных.
      </div>

      <Footer />
    </div>
  );
}
