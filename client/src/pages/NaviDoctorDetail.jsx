import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function VisitCard({ visit, canEdit, onReported }) {
  const { t } = useLanguage();
  const [report, setReport] = useState(visit.mp_report || "");
  const [editing, setEditing] = useState(!visit.mp_report && canEdit);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try { await api.reportNaviVisit(visit.id, report); setEditing(false); onReported(); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl p-4 mb-3" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="flex items-center gap-2 mb-2">
        <img src="/navi.png" alt="NAVI" style={{ height: "28px", width: "auto" }} />
        <div className="text-xs" style={{ color: "#6B7280" }}>{String(visit.visit_date).slice(0, 10)}</div>
      </div>
      <div className="text-sm rounded-lg p-3 mb-3" style={{ background: "#EEF1F8", whiteSpace: "pre-wrap" }}>{visit.ai_recommendation}</div>

      {visit.mp_report && !editing ? (
        <div>
          <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.visit_result")}</div>
          <div className="text-sm">{visit.mp_report}</div>
          {canEdit && <button onClick={() => setEditing(true)} className="text-xs mt-2" style={{ color: "#ED3237" }}>{t("common.change")}</button>}
        </div>
      ) : canEdit ? (
        <div>
          <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.report_visit")}</div>
          <textarea rows={3} value={report} onChange={(e) => setReport(e.target.value)} placeholder={t("navi.report_placeholder")}
            className="w-full bg-transparent border rounded px-3 py-2 text-sm mb-2" style={{ borderColor: "#D3D8E4" }} />
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("navi.save_visit")}</button>
        </div>
      ) : (
        <div className="text-xs" style={{ color: "#6B7280" }}>{t("navi.no_report_yet")}</div>
      )}
    </div>
  );
}

export default function NaviDoctorDetail({ doctorId, user, onBack }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  async function load() {
    setData(await api.getNaviDoctor(doctorId));
  }
  useEffect(() => { load(); }, [doctorId]);

  if (!data) return <div className="p-8" style={{ color: "#6B7280" }}>{t("common.loading")}</div>;

  async function startVisit() {
    setStarting(true); setError("");
    try { await api.startNaviVisit(doctorId, lang); await load(); }
    catch (e) { setError(e.message); } finally { setStarting(false); }
  }

  async function remove() {
    if (!confirm(t("navi.confirm_delete"))) return;
    try { await api.deleteNaviDoctor(doctorId); onBack(); } catch (e) { setError(e.message); }
  }

  const canEdit = data.can_edit;
  const d = data.doctor;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8">
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#6B7280" }}>← {t("common.back")}</button>

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="font-display text-2xl font-semibold">{d.last_name} {d.first_name} {d.patronymic}</div>
            <div className="text-sm" style={{ color: "#6B7280" }}>{d.specialty || "—"} · {d.lpu || "—"} · {d.city || "—"}</div>
          </div>
          {canEdit && <button onClick={remove} className="text-xs" style={{ color: "#DC2626" }}>{t("common.delete")}</button>}
        </div>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          {d.experience_years != null && <div><span style={{ color: "#6B7280" }}>{t("navi.experience")}:</span> {d.experience_years}</div>}
          {d.psychotype && <div><span style={{ color: "#6B7280" }}>{t("navi.psychotype")}:</span> {d.psychotype}</div>}
          {d.visit_minutes != null && <div><span style={{ color: "#6B7280" }}>{t("navi.visit_minutes")}:</span> {d.visit_minutes}</div>}
        </div>
        {d.needs && <div className="mt-2 text-sm"><span style={{ color: "#6B7280" }}>{t("navi.needs")}:</span> {d.needs}</div>}
        {d.behavior && <div className="mt-1 text-sm"><span style={{ color: "#6B7280" }}>{t("navi.behavior")}:</span> {d.behavior}</div>}

        {data.products.length > 0 && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "#E4E7F0" }}>
            <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.prescribes")}</div>
            <div className="flex flex-wrap gap-2">
              {data.products.map((p) => (
                <span key={p.id} className="text-xs px-2 py-1 rounded-full" style={{ background: "#EEF1F8" }}>{p.product_name}: {p.prescriptions}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="rounded-2xl p-5 mb-6 text-center" style={{ background: "linear-gradient(135deg,#EEF1F8,#F7F8FC)", border: "1px solid #E4E7F0" }}>
          <img src="/navi.png" alt="NAVI" style={{ height: "72px", width: "auto" }} className="mx-auto mb-2" />
          <div className="text-sm mb-3" style={{ color: "#6B7280" }}>{t("navi.start_visit_hint")}</div>
          <button onClick={startVisit} disabled={starting} className="px-6 py-3 rounded-full font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>
            {starting ? t("navi.thinking") : t("navi.start_visit")}
          </button>
          {error && <div className="text-sm mt-3" style={{ color: "#DC2626" }}>{error}</div>}
        </div>
      )}

      <div className="font-display text-lg mb-3">{t("navi.visit_history")}</div>
      {data.visits.map((v) => <VisitCard key={v.id} visit={v} canEdit={canEdit} onReported={load} />)}
      {data.visits.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("navi.no_visits")}</div>}
    </div>
  );
}
