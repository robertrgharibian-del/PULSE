import React, { useState } from "react";
import { api } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function Profile({ user, onUpdated }) {
  const { t } = useLanguage();
  const [fullName, setFullName] = useState(user.full_name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoKey, setPhotoKey] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setError(""); setOk(false); setBusy(true);
    try {
      const payload = {};
      if (fullName !== user.full_name) payload.full_name = fullName;
      if (newPassword) { payload.password = newPassword; payload.current_password = currentPassword; }
      if (Object.keys(payload).length === 0) { setBusy(false); return; }
      await api.updateMe(payload);
      setOk(true);
      setCurrentPassword(""); setNewPassword("");
      onUpdated?.({ ...user, full_name: fullName });
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  }

  async function uploadPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoBusy(true); setError("");
    try {
      await api.uploadMyPhoto(file);
      setPhotoKey((k) => k + 1);
    } catch (e2) { setError(e2.message); } finally { setPhotoBusy(false); e.target.value = ""; }
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-5 py-10">
      <div className="font-display text-2xl font-semibold mb-1">{t("nav.profile")}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{user.email}</div>

      <div className="rounded-2xl p-5 mb-4 flex items-center gap-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div key={photoKey}><Avatar userId={user.id} name={fullName} size={64} /></div>
        <label className="px-4 py-2 rounded text-sm font-semibold cursor-pointer" style={{ background: "#E4E7F0", color: "#1F2937" }}>
          {photoBusy ? t("common.loading") : t("profile.upload_photo")}
          <input type="file" accept="image/*" onChange={uploadPhoto} className="hidden" disabled={photoBusy} />
        </label>
      </div>

      <form onSubmit={save} className="rounded-2xl p-5 space-y-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div>
          <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "#6B7280" }}>{t("common.name")}</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        </div>
        <div className="pt-2 border-t" style={{ borderColor: "#E4E7F0" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#6B7280" }}>{t("profile.change_password")}</div>
          <input type="password" placeholder={t("profile.current_password")} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full mb-2 bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
          <input type="password" placeholder={t("profile.new_password")} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            className="w-full bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        </div>
        {error && <div className="text-sm" style={{ color: "#DC2626" }}>{error}</div>}
        {ok && <div className="text-sm" style={{ color: "#16A34A" }}>✓ {t("common.saved")}</div>}
        <button disabled={busy} type="submit" className="w-full py-2.5 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>
          {busy ? t("profile.saving") : t("common.save")}
        </button>
      </form>
    </div>
  );
}
