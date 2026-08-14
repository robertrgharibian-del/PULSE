import React, { useState } from "react";
import { api } from "../api.js";
import ReportView from "../components/ReportView.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const MONTHS = {
  ru: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  uz: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"],
};

export default function MpPanel({ user }) {
  const { t, lang } = useLanguage();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [reportId, setReportId] = useState(null);
  const [error, setError] = useState("");
  const months = MONTHS[lang] || MONTHS.ru;

  async function open() {
    setError("");
    try {
      const r = await api.getOrCreateReport(year, month);
      setReportId(r.id);
    } catch (e) {
      setError(e.message);
    }
  }

  if (reportId) return <ReportView reportId={reportId} user={user} onBack={() => setReportId(null)} />;

  return (
    <div className="max-w-2xl mx-auto px-5 py-12">
      <div className="font-display text-2xl font-semibold mb-1">{t("mp.my_report")}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("mp.choose_period")}</div>
      <div className="rounded-2xl p-6 flex flex-wrap items-end gap-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "#6B7280" }}>{t("common.month")}</span>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
            {months.map((m, i) => <option key={m} value={i + 1} style={{ color: "#000" }}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: "#6B7280" }}>{t("common.year")}</span>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="bg-transparent border rounded px-3 py-2 w-24" style={{ borderColor: "#D3D8E4" }} />
        </label>
        <button onClick={open} className="px-5 py-2.5 rounded font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>{t("mp.open_report")}</button>
      </div>
      {error && <div className="text-sm mt-4" style={{ color: "#DC2626" }}>{error}</div>}
    </div>
  );
}
