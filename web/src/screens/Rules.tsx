import { useState } from "react";
import WebApp from "@twa-dev/sdk";
import { useStore } from "../lib/store";
import { apiAcceptRules } from "../lib/api";
import Footer from "../components/Footer";

export default function Rules() {
  const profile = useStore((s) => s.profile);
  const patchProfile = useStore((s) => s.patchProfile);
  const setScreen = useStore((s) => s.setScreen);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const me = await apiAcceptRules();
      patchProfile({ rulesAccepted: true });
      // Если профиль уже заполнен — сразу домой. Иначе на онбординг.
      setScreen(me.faculty && me.course ? "home" : "profile");
    } catch (e) {
      WebApp.showAlert("Не удалось сохранить согласие. Попробуй ещё раз.");
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 gap-6">
      <div>
        <div className="text-3xl">🎙</div>
        <div className="text-2xl font-semibold mt-3">
          Добро пожаловать, {profile?.firstName ?? "друг"}
        </div>
        <div className="text-muted mt-1">
          Пара коротких правил, чтобы здесь было приятно.
        </div>
      </div>

      <ul className="flex flex-col gap-4 mt-2">
        <Rule emoji="🎤" title="Только голос">
          Видео нет. Разговор не записывается — ни на сервере, ни в боте.
        </Rule>
        <Rule emoji="🙌" title="Будь вежлив">
          Если человек тебе не интересен — просто жми "Дальше". Не оскорбляй,
          не настаивай, не выпрашивай личные данные.
        </Rule>
        <Rule emoji="🤍" title="Сердечко = симпатия">
          Тапнул сердечко — собеседник не узнает. Если он тоже тапнул — обменяетесь
          контактами в Telegram. Никакого социального давления.
        </Rule>
        <Rule emoji="🚨" title="Жалуйся, если что">
          В звонке есть кнопка "Жалоба" — нажми, если собеседник нарушает.
          После 3 жалоб юзера автоматически блокируем.
        </Rule>
      </ul>

      <div className="flex-1" />

      <button
        onClick={accept}
        disabled={busy}
        className="bg-accent text-white rounded-2xl py-4 font-semibold disabled:opacity-40"
      >
        {busy ? "Минутку…" : "Согласен, поехали"}
      </button>

      <Footer />
    </div>
  );
}

function Rule({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <div className="text-2xl shrink-0">{emoji}</div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-muted text-sm mt-0.5">{children}</div>
      </div>
    </li>
  );
}
