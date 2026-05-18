import { useState } from "react";
import WebApp from "@twa-dev/sdk";
import { useStore } from "../lib/store";
import { apiReact } from "../lib/api";

export default function AfterCall() {
  const call = useStore((s) => s.call);
  const setScreen = useStore((s) => s.setScreen);
  const setCall = useStore((s) => s.setCall);

  const [save, setSave] = useState(false);
  const [sent, setSent] = useState(false);
  const [mutualUsername, setMutualUsername] = useState<string | undefined>();

  if (!call) {
    setScreen("home");
    return null;
  }

  const submit = async (reaction: "like" | "dislike") => {
    if (sent) return;
    setSent(true);
    try {
      const r = await apiReact(call.roomName, reaction, save);
      if (r.mutual && r.peer_username) setMutualUsername(r.peer_username);
    } catch (e) {
      WebApp.showAlert("Не удалось отправить — но это ок, идём дальше.");
    }
  };

  const back = () => {
    setCall(null);
    setScreen("home");
  };

  return (
    <div className="flex-1 flex flex-col p-6 gap-6">
      <div className="text-center">
        <div className="text-2xl font-semibold">Как вам разговор?</div>
        <div className="text-muted mt-1">С {call.peerName}</div>
      </div>

      {!sent ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => submit("dislike")}
              className="rounded-2xl py-8 bg-white/5 text-3xl"
            >
              👎
            </button>
            <button
              onClick={() => submit("like")}
              className="rounded-2xl py-8 bg-white/10 text-3xl"
            >
              👍
            </button>
          </div>

          <label className="flex items-center gap-3 p-4 rounded-2xl bg-white/5">
            <input
              type="checkbox"
              checked={save}
              onChange={(e) => setSave(e.target.checked)}
              className="w-5 h-5"
            />
            <span>Сохранить контакт, если собеседник тоже захочет</span>
          </label>
        </>
      ) : mutualUsername ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-5 text-center">
          <div className="text-3xl mb-2">🎉</div>
          <div className="font-semibold">Взаимно!</div>
          <div className="text-muted mt-2">Можешь написать собеседнику в Telegram:</div>
          <a
            href={`https://t.me/${mutualUsername}`}
            className="inline-block mt-3 bg-accent text-white rounded-xl px-5 py-2 font-semibold"
          >
            @{mutualUsername}
          </a>
        </div>
      ) : (
        <div className="text-center text-muted">
          Спасибо! Это поможет нам подбирать лучше.
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={back}
        className="bg-accent text-white rounded-2xl py-4 font-semibold"
      >
        Следующий собеседник
      </button>
    </div>
  );
}
