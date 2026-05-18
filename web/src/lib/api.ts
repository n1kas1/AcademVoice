// Тонкая обёртка вокруг fetch к нашему FastAPI.
// Все запросы шлют initData из Telegram WebApp как Bearer-токен —
// бэк валидирует подпись и достаёт user.id.

import WebApp from "@twa-dev/sdk";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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
}

export const apiMe = () => req<MeResponse>("/me");

export const apiUpdateProfile = (p: { faculty: string; course: string }) =>
  req<MeResponse>("/me", { method: "PATCH", body: JSON.stringify(p) });

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

// === After-call ===

export interface ReactionResponse {
  mutual: boolean;
  peer_username?: string;
}

export const apiReact = (
  roomName: string,
  reaction: "like" | "dislike",
  saveContact: boolean
) =>
  req<ReactionResponse>("/call/reaction", {
    method: "POST",
    body: JSON.stringify({
      room_name: roomName,
      reaction,
      save_contact: saveContact,
    }),
  });

export const apiReport = (roomName: string, reason: string) =>
  req<{ ok: true }>("/call/report", {
    method: "POST",
    body: JSON.stringify({ room_name: roomName, reason }),
  });
