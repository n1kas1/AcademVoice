import { useState } from "react";
import WebApp from "@twa-dev/sdk";
import { useStore } from "../lib/store";
import { FACULTIES, COURSES } from "../lib/faculties";
import { apiUpdateProfile } from "../lib/api";

export default function Profile() {
  const profile = useStore((s) => s.profile);
  const patchProfile = useStore((s) => s.patchProfile);
  const setScreen = useStore((s) => s.setScreen);

  const [faculty, setFaculty] = useState(profile?.faculty ?? "");
  const [course, setCourse] = useState(profile?.course ?? "");
  const [saving, setSaving] = useState(false);

  const canSave = faculty && course && !saving;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await apiUpdateProfile({ faculty, course });
      patchProfile({ faculty, course });
      setScreen("home");
    } catch (e) {
      WebApp.showAlert("Не удалось сохранить профиль — попробуй ещё раз");
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col p-6 gap-6">
      <div>
        <div className="text-2xl font-semibold">Привет, {profile?.firstName} 👋</div>
        <div className="text-muted mt-1">
          Пара мелочей перед стартом — это покажется собеседнику.
        </div>
      </div>

      <Field label="Факультет">
        <select
          value={faculty}
          onChange={(e) => setFaculty(e.target.value)}
          className="bg-white/5 rounded-xl px-4 py-3 outline-none"
        >
          <option value="">— выбери —</option>
          {FACULTIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Курс">
        <select
          value={course}
          onChange={(e) => setCourse(e.target.value)}
          className="bg-white/5 rounded-xl px-4 py-3 outline-none"
        >
          <option value="">— выбери —</option>
          {COURSES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex-1" />

      <button
        disabled={!canSave}
        onClick={onSave}
        className="bg-accent text-white rounded-2xl py-4 font-semibold disabled:opacity-40"
      >
        {saving ? "Сохраняем…" : "Поехали"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-muted text-sm">{label}</span>
      {children}
    </label>
  );
}
