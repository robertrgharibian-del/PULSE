import React, { useEffect, useState } from "react";
import { api, monthName } from "../api.js";
import ReportView from "../components/ReportView.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function BmReports({ user }) {
  const { t } = useLanguage();
  const [reports, setReports] = useState([]);
  const [reportId, setReportId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const rows = await api.listReports();
    setReports(rows);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (reportId) return <ReportView reportId={reportId} user={user} onBack={() => { setReportId(null); load(); }} />;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-10">
      <div className="font-display text-2xl font-semibold mb-1">{t("nav.reports")} — {user.group_name || t("bm.my_group")}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("bm.subtitle")}</div>
      {loading ? <div>{t("common.loading")}</div> : (
        <div className="rounded-2xl overflow-x-auto" style={{ border: "1px solid #E4E7F0" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#F7F8FC", color: "#6B7280" }} className="uppercase text-xs">
                <th className="text-left px-4 py-3">{t("role.mp")}</th>
                <th className="text-left px-4 py-3">{t("common.territory")}</th>
                <th className="text-left px-4 py-3">{t("common.period")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #E4E7F0" }}>
                  <td className="px-4 py-3">{r.mp_name}</td>
                  <td className="px-4 py-3" style={{ color: "#6B7280" }}>{r.mp_territory || "—"}</td>
                  <td className="px-4 py-3 font-mono">{monthName(r.period_month)} {r.period_year}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => setReportId(r.id)} className="px-3 py-1.5 rounded" style={{ background: "#E4E7F0" }}>{t("common.open")}</button></td>
                </tr>
              ))}
              {reports.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center" style={{ color: "#6B7280" }}>{t("bm.no_approved")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
