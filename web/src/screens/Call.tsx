import { useEffect, useRef, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { useStore } from "../lib/store";
import { joinCall, type CallHandle } from "../lib/livekit";
import { apiSkip, apiReport } from "../lib/api";

export default function Call() {
  const call = useStore((s) => s.call);
  const setScreen = useStore((s) => s.setScreen);

  const handleRef = useRef<CallHandle | null>(null);
  const peerAudioRef = useRef<HTMLAudioElement | null>(null);

  const [secs, setSecs] = useState(0);
  const [muted, setMuted] = useState(false);
  const [connecting, setConnecting] = useState(true);

  useEffect(() => {
    if (!call) return;
    let alive = true;

    (async () => {
      try {
        const h = await joinCall(
          call.wsUrl,
          call.token,
          (el) => {
            peerAudioRef.current = el;
          },
          () => {
            // peer disconnected — переводим на after-call
            if (alive) setScreen("aftercall");
          }
        );
        if (!alive) {
          await h.disconnect();
          return;
        }
        handleRef.current = h;
        setConnecting(false);
      } catch (e) {
        console.error(e);
        WebApp.showAlert("Не удалось подключиться. Попробуй ещё раз.");
        setScreen("home");
      }
    })();

    const t = window.setInterval(() => setSecs((x) => x + 1), 1000);
    return () => {
      alive = false;
      clearInterval(t);
      handleRef.current?.disconnect();
      if (peerAudioRef.current) {
        peerAudioRef.current.remove();
        peerAudioRef.current = null;
      }
    };
  }, [call, setScreen]);

  if (!call) return null;

  const next = async () => {
    try {
      await apiSkip(call.roomName);
    } catch {}
    setScreen("aftercall");
  };

  const end = async () => {
    setScreen("aftercall");
  };

  const toggleMute = async () => {
    const m = !muted;
    setMuted(m);
    await handleRef.current?.setMuted(m);
  };

  const report = async () => {
    WebApp.showConfirm("Пожаловаться на собеседника?", async (ok) => {
      if (!ok) return;
      try {
        await apiReport(call.roomName, "user_report");
      } catch {}
      WebApp.showAlert("Принято. Спасибо.");
      setScreen("aftercall");
    });
  };

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="flex-1 flex flex-col p-6 gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">{connecting ? "Соединение…" : "В эфире"}</div>
        <div className="text-sm tabular-nums">{mm}:{ss}</div>
        <button onClick={report} className="text-xs text-muted underline">
          Жалоба
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <div className="w-32 h-32 rounded-full bg-white/10 flex items-center justify-center text-4xl">
          {call.peerName?.[0] ?? "🙂"}
        </div>
        <div className="text-xl font-semibold">{call.peerName}</div>
        <div className="text-muted text-sm text-center">
          {call.peerFaculty}
          {call.peerCourse && ` · ${call.peerCourse}`}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={toggleMute}
          className="rounded-2xl py-4 bg-white/5 font-medium"
        >
          {muted ? "🔇 Вкл" : "🎤 Микро"}
        </button>
        <button
          onClick={next}
          className="rounded-2xl py-4 bg-white/10 font-medium"
        >
          ⏭ Дальше
        </button>
        <button
          onClick={end}
          className="rounded-2xl py-4 bg-red-500 text-white font-medium"
        >
          ✖ Стоп
        </button>
      </div>
    </div>
  );
}
