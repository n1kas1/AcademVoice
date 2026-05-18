import { useEffect, useRef } from "react";
import { useStore } from "../lib/store";
import { apiPoll, apiLeaveQueue } from "../lib/api";

export default function Searching() {
  const setScreen = useStore((s) => s.setScreen);
  const setCall = useStore((s) => s.setCall);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;

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
      if (timer.current) clearTimeout(timer.current);
    };
  }, [setScreen, setCall]);

  const cancel = async () => {
    try {
      await apiLeaveQueue();
    } catch {}
    setScreen("home");
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-accent/30 animate-ping" />
        <div className="relative w-32 h-32 rounded-full bg-accent/20 flex items-center justify-center text-5xl">
          🎙
        </div>
      </div>
      <div className="text-xl font-semibold">Ищем собеседника…</div>
      <div className="text-muted text-center max-w-xs text-sm">
        Обычно это занимает несколько секунд. Жди или нажми отмену.
      </div>
      <button
        onClick={cancel}
        className="mt-4 text-muted underline underline-offset-4"
      >
        Отмена
      </button>
    </div>
  );
}
