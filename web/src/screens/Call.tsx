import { useEffect, useRef, useState } from "react";
import WebApp from "@twa-dev/sdk";
import { useStore } from "../lib/store";
import { joinCall, type CallHandle } from "../lib/livekit";
import { apiSkip, apiReport, apiLike } from "../lib/api";

export default function Call() {
  const call = useStore((s) => s.call);
  const setCall = useStore((s) => s.setCall);
  const setScreen = useStore((s) => s.setScreen);

  const handleRef = useRef<CallHandle | null>(null);
  const peerAudioRef = useRef<HTMLAudioElement | null>(null);

  const [secs, setSecs] = useState(0);
  const [muted, setMuted] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [liked, setLiked] = useState(false); // нажал ли я сердечко
  const [pulsing, setPulsing] = useState(false); // анимация после нажатия

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
          async () => {
            // peer ушёл — закроем звонок и перейдём на after-call
            if (!alive) return;
            try {
              await apiSkip(call.roomName);
            } catch {}
            setScreen("aftercall");
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

  const finish = async (intent: "skip" | "end") => {
    // В обоих случаях фиксируем ended_at, чтобы аналитика считалась.
    try {
      await apiSkip(call.roomName);
    } catch {}
    setScreen("aftercall");
    void intent; // intent пока не различаем поведенчески
  };

  const next = () => finish("skip");
  const end = () => finish("end");

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
      await finish("end");
    });
  };

  // Невидимое сердечко: peer не узнает, что я нажал. Если он тоже нажал —
  // на AfterCall будет mutual + обмен @username.
  const sendLike = async () => {
    if (liked) return;
    setLiked(true);
    setPulsing(true);
    setTimeout(() => setPulsing(false), 600);
    try {
      const r = await apiLike(call.roomName);
      // Сохраняем mutual, чтобы AfterCall показал его без задержки.
      if (r.mutual) {
        setCall({
          ...call,
          mutual: true,
          mutualUsername: r.peer_username,
        });
      }
    } catch {
      // молча — пользователю незачем знать о сетевых ошибках по сердечку
    }
  };

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="flex-1 flex flex-col p-6 gap-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted">
          {connecting ? "Соединение…" : "В эфире"}
        </div>
        <div className="text-sm tabular-nums">
          {mm}:{ss}
        </div>
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

        {/* Сердечко — большая отдельная кнопка по центру */}
        <button
          onClick={sendLike}
          disabled={liked}
          className={`mt-6 w-20 h-20 rounded-full flex items-center justify-center text-4xl transition-transform ${
            pulsing ? "scale-125" : "scale-100"
          } ${
            liked
              ? "bg-red-500/30 ring-2 ring-red-500"
              : "bg-white/5 active:scale-95"
          }`}
          aria-label="Отправить сердечко"
        >
          {liked ? "❤️" : "🤍"}
        </button>
        <div className="text-xs text-muted text-center max-w-[18rem]">
          {liked
            ? "Сердечко отправлено. Если собеседник тоже нажмёт — обменяетесь контактами."
            : "Понравился собеседник? Тапни сердечко — он не увидит."}
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
