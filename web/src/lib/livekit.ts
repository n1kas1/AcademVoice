// Тонкая обёртка над livekit-client: подключение к комнате,
// захват микрофона, отключение, прокидывание метрик голоса.

import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type LocalAudioTrack,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RemoteParticipant,
} from "livekit-client";

export interface CallHandle {
  room: Room;
  disconnect: () => Promise<void>;
  setMuted: (m: boolean) => Promise<void>;
}

export async function joinCall(
  wsUrl: string,
  token: string,
  onPeerAudio: (el: HTMLAudioElement) => void,
  onPeerLeft: () => void
): Promise<CallHandle> {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  room.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, _pub: RemoteTrackPublication, _p: RemoteParticipant) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach() as HTMLAudioElement;
        el.autoplay = true;
        document.body.appendChild(el);
        onPeerAudio(el);
      }
    }
  );

  room.on(RoomEvent.ParticipantDisconnected, () => onPeerLeft());
  room.on(RoomEvent.Disconnected, () => onPeerLeft());

  await room.connect(wsUrl, token);

  const mic: LocalAudioTrack = await createLocalAudioTrack();
  await room.localParticipant.publishTrack(mic);

  return {
    room,
    disconnect: async () => {
      mic.stop();
      await room.disconnect();
    },
    setMuted: async (m: boolean) => {
      await mic.mute();
      if (!m) await mic.unmute();
    },
  };
}
