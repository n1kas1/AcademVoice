import { useEffect } from "react";
import WebApp from "@twa-dev/sdk";
import { useStore } from "./lib/store";
import { apiMe } from "./lib/api";
import Splash from "./screens/Splash";
import Rules from "./screens/Rules";
import Profile from "./screens/Profile";
import Home from "./screens/Home";
import Searching from "./screens/Searching";
import Call from "./screens/Call";
import AfterCall from "./screens/AfterCall";

export default function App() {
  const screen = useStore((s) => s.screen);
  const setScreen = useStore((s) => s.setScreen);
  const setProfile = useStore((s) => s.setProfile);

  useEffect(() => {
    // Раскрываем Mini App на весь экран и подгоняем под тг-тему.
    WebApp.ready();
    WebApp.expand();
    document.body.style.background =
      WebApp.themeParams.bg_color || "#0f0f0f";

    // Грузим профиль с бэка: бэк сам создаст юзера на лету, если его нет.
    apiMe()
      .then((me) => {
        setProfile({
          tgId: me.tg_id,
          username: me.username,
          firstName: me.first_name,
          faculty: me.faculty,
          course: me.course,
          rulesAccepted: me.rules_accepted,
          allowPm: me.allow_pm,
          streak: me.streak,
        });
        // Маршрутизация:
        //   правила не приняты      → Rules
        //   приняты, но без анкеты  → Profile
        //   всё заполнено           → Home
        if (!me.rules_accepted) setScreen("rules");
        else if (!me.faculty || !me.course) setScreen("profile");
        else setScreen("home");
      })
      .catch((err) => {
        console.error("apiMe failed", err);
        // Без бэка всё равно даём посмотреть UI — заглушка из tg user.
        const u = WebApp.initDataUnsafe?.user;
        setProfile({
          tgId: u?.id ?? 0,
          username: u?.username,
          firstName: u?.first_name ?? "Гость",
          rulesAccepted: false,
        });
        setScreen("rules");
      });
  }, [setScreen, setProfile]);

  return (
    <div className="min-h-full bg-bg text-fg flex flex-col">
      {screen === "splash" && <Splash />}
      {screen === "rules" && <Rules />}
      {screen === "profile" && <Profile />}
      {screen === "home" && <Home />}
      {screen === "searching" && <Searching />}
      {screen === "call" && <Call />}
      {screen === "aftercall" && <AfterCall />}
    </div>
  );
}
