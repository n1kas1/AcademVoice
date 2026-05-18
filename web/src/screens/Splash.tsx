export default function Splash() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-5xl">🎙</div>
      <div className="text-2xl font-semibold">Академ.voice</div>
      <div className="text-muted text-center">
        Голосовая чатрулетка для своих
      </div>
      <div className="mt-6 h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}
