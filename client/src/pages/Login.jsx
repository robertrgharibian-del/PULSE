import React, { useState } from "react";
import { api } from "../api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function Login({ onLogin }) {
  const { t, lang, setLang } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { token, user } = await api.login(email, password);
      localStorage.setItem("fss_token", token);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.requestReset(resetEmail);
      setResetSent(true);
    } catch (err) {
      setResetSent(true); // don't reveal whether the email exists
    } finally {
      setBusy(false);
    }
  }

  const langSwitcher = (
    <div className="flex rounded-lg overflow-hidden text-xs font-semibold absolute top-4 right-4" style={{ border: "1px solid #E4E7F0" }}>
      <button type="button" onClick={() => setLang("ru")} className="px-2.5 py-1.5" style={{ background: lang === "ru" ? "#3E4095" : "transparent", color: lang === "ru" ? "#FFFFFF" : "#6B7280" }}>RU</button>
      <button type="button" onClick={() => setLang("uz")} className="px-2.5 py-1.5" style={{ background: lang === "uz" ? "#3E4095" : "transparent", color: lang === "uz" ? "#FFFFFF" : "#6B7280" }}>UZ</button>
    </div>
  );

  if (resetMode) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative">
        {langSwitcher}
        <form onSubmit={submitReset} className="w-full max-w-sm rounded-2xl p-8" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <h1 className="font-display text-xl font-semibold mb-2">{t("login.reset_title")}</h1>
          <p className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("login.reset_desc")}</p>
          {resetSent ? (
            <>
              <div className="text-sm mb-6 px-3 py-2 rounded" style={{ background: "#16A34A22", color: "#16A34A" }}>
                {t("login.reset_sent")}
              </div>
              <button type="button" onClick={() => { setResetMode(false); setResetSent(false); }} className="w-full py-2.5 rounded font-semibold" style={{ background: "#E4E7F0" }}>
                {t("login.reset_back")}
              </button>
            </>
          ) : (
            <>
              <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "#6B7280" }}>{t("common.email")}</label>
              <input value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} type="email" required
                className="w-full mb-6 bg-transparent border rounded px-3 py-2 outline-none" style={{ borderColor: "#D3D8E4" }} />
              <button disabled={busy} type="submit" className="w-full py-2.5 rounded font-semibold mb-3" style={{ background: "#ED3237", color: "#FFFFFF" }}>
                {busy ? "…" : t("login.reset_submit")}
              </button>
              <button type="button" onClick={() => setResetMode(false)} className="w-full py-2 text-sm" style={{ color: "#6B7280" }}>{t("login.reset_back")}</button>
            </>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative">
      {langSwitcher}
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl p-8" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <img src="/pulse-logo.png" alt="PULSE" style={{ height: "40px", width: "auto" }} className="mb-4" />
        <h1 className="font-display text-2xl font-semibold mb-1">{t("login.title")}</h1>
        <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("app.tagline")}</div>

        <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "#6B7280" }}>{t("login.email")}</label>
        <input
          value={email} onChange={(e) => setEmail(e.target.value)} type="email" required
          className="w-full mb-4 bg-transparent border rounded px-3 py-2 outline-none"
          style={{ borderColor: "#D3D8E4" }}
        />
        <label className="block text-xs uppercase tracking-wide mb-1" style={{ color: "#6B7280" }}>{t("login.password")}</label>
        <input
          value={password} onChange={(e) => setPassword(e.target.value)} type="password" required
          className="w-full mb-2 bg-transparent border rounded px-3 py-2 outline-none"
          style={{ borderColor: "#D3D8E4" }}
        />
        <button type="button" onClick={() => setResetMode(true)} className="text-xs mb-6" style={{ color: "#6B7280" }}>{t("login.forgot")}</button>
        {error && <div className="text-sm mb-4" style={{ color: "#DC2626" }}>{error}</div>}
        <button disabled={busy} type="submit"
          className="w-full py-2.5 rounded font-semibold"
          style={{ background: "#ED3237", color: "#FFFFFF" }}>
          {busy ? t("login.submitting") : t("login.submit")}
        </button>
      </form>
    </div>
  );
}
