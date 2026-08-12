import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import ReportView from "../components/ReportView.jsx";

export default function BmReports({ user }) {
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
      <div className="font-display text-2xl font-semibold mb-1">Отчёты — {user.group_name || "моя группа"}</div>
      <div className="text-sm mb-6" style={{ color: "#8493AA" }}>Одобренные отчёты медпредов вашей группы</div>
      {loading ? <div>Загрузка…</div> : (
        <div className="rounded-2xl overflow-x-auto" style={{ border: "1px solid #22304A" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#141F33", color: "#8493AA" }} className="uppercase text-xs">
                <th className="text-left px-4 py-3">Медпред</th>
                <th className="text-left px-4 py-3">Территория</th>
                <th className="text-left px-4 py-3">Период</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #22304A" }}>
                  <td className="px-4 py-3">{r.mp_name}</td>
                  <td className="px-4 py-3" style={{ color: "#8493AA" }}>{r.mp_territory || "—"}</td>
                  <td className="px-4 py-3 font-mono">{r.period_month}/{r.period_year}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => setReportId(r.id)} className="px-3 py-1.5 rounded" style={{ background: "#22304A" }}>Открыть</button></td>
                </tr>
              ))}
              {reports.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center" style={{ color: "#8493AA" }}>Пока нет одобренных отчётов</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
