import { create } from "zustand";

export type Screen =
  | "splash"
  | "rules"
  | "profile"
  | "home"
  | "searching"
  | "call"
  | "aftercall";

export interface Profile {
  tgId: number;
  username?: string;
  firstName: string;
  faculty?: string;
  course?: string;
  rulesAccepted?: boolean;
  allowPm?: boolean;
  streak?: number;
}

export interface CallSession {
  roomName: string;
  token: string;
  wsUrl: string;
  peerName: string;
  peerFaculty?: string;
  peerCourse?: string;
  peerTgId: number;
  peerUsername?: string;
  // Состояние взаимной симпатии — заполняется когда апи отдаёт mutual=true
  // (либо во время звонка, либо при перепроверке на экране AfterCall).
  mutual?: boolean;
  mutualUsername?: string;
  // Длительность звонка в секундах (для анти-разочарования на AfterCall).
  callDurationSecs?: number;
}

interface State {
  screen: Screen;
  profile: Profile | null;
  call: CallSession | null;
  setScreen: (s: Screen) => void;
  setProfile: (p: Profile) => void;
  patchProfile: (p: Partial<Profile>) => void;
  setCall: (c: CallSession | null) => void;
}

export const useStore = create<State>((set) => ({
  screen: "splash",
  profile: null,
  call: null,
  setScreen: (screen) => set({ screen }),
  setProfile: (profile) => set({ profile }),
  patchProfile: (p) =>
    set((s) => ({ profile: s.profile ? { ...s.profile, ...p } : null })),
  setCall: (call) => set({ call }),
}));
