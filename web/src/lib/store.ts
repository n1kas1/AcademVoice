import { create } from "zustand";

export type Screen =
  | "splash"
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
