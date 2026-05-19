// Тонкая обёртка вокруг fetch к нашему FastAPI.
// Все запросы шлют initData из Telegram WebApp как Bearer-токен —
// бэк валидирует подпись и достаёт user.id.

import WebApp from "@twa-dev/sdk";

// Бэк и фронт живут на одном Caddy: same-origin, fetch идёт по относительному пути.
const BASE = import.meta.env.VITE_API_URL ?? "";

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const initData = WebApp.initData || "";
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `tma ${initData}`,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

// === Auth / Profile ===

export interface MeResponse {
  tg_id: number;
  username?: string;
  first_name: string;
  faculty?: string;
  course?: string;
  rules_accepted: boolean;
}

export const apiMe = () => req<MeResponse>("/me");

export const apiUpdateProfile = (p: { faculty: string; course: string }) =>
  req<MeResponse>("/me", { method: "PATCH", body: JSON.stringify(p) });

export const apiAcceptRules = () =>
  req<MeResponse>("/me/accept-rules", { method: "POST" });

// === Matching ===

export interface MatchResponse {
  status: "queued" | "matched";
  room_name?: string;
  token?: string;
  ws_url?: string;
  peer?: {
    tg_id: number;
    first_name: string;
    username?: string;
    faculty?: string;
    course?: string;
  };
}

export const apiJoinQueue = () =>
  req<MatchResponse>("/match/join", { method: "POST" });

export const apiPoll = () => req<MatchResponse>("/match/poll");

export const apiLeaveQueue = () =>
  req<{ ok: true }>("/match/leave", { method: "POST" });

export const apiSkip = (roomName: string) =>
  req<{ ok: true }>("/call/skip", {
    method: "POST",
    body: JSON.stringify({ room_name: roomName }),
  });

// === Сердечко во время звонка ===

export interface LikeResponse {
  mutual: boolean;
  peer_username?: string;
  peer_first_name?: string;
}

// Отправить "сердечко" собеседнику. Если оба нажали — обмен @username.
// peer этого вызова не видит — никакого социального давления.
export const apiLike = (roomName: string) =>
  req<LikeResponse>("/call/reaction", {
    method: "POST",
    body: JSON.stringify({
      room_name: roomName,
      reaction: "like",
      save_contact: true,
    }),
  });

// На AfterCall — повторно проверяем, не нажал ли peer сердечко уже после нас.
export const apiCallResult = (roomName: string) =>
  req<LikeResponse>(`/call/${encodeURIComponent(roomName)}/result`);

export const apiReport = (roomName: string, reason: string) =>
  req<{ ok: true }>("/call/report", {
    method: "POST",
    body: JSON.stringify({ room_name: roomName, reason }),
  });

// === Соц-пруф для Searching ===

export interface StatsResponse {
  queue_size: number;
  calls_last_hour: number;
  active_24h: number;
}

export const apiStats = () => req<StatsResponse>("/stats");
