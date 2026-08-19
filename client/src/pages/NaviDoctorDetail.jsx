import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import Lightbox from "../components/Lightbox.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const SECTION_KEYS = [
  ["prior_analysis", "navi.sec_prior_analysis"],
  ["general_recommendations", "navi.sec_general"],
  ["technique", "navi.sec_technique"],
  ["what_to_say", "navi.sec_what_to_say"],
  ["what_to_avoid", "navi.sec_what_to_avoid"],
  ["must_not_do", "navi.sec_must_not_do"],
  ["timing", "navi.sec_timing"],
  ["closing", "navi.sec_closing"],
];

function CompetitorRows({ competitors, onChange, t }) {
  return (
    <div className="mt-2">
      <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.competitors")}</div>
      {competitors.map((c, idx) => (
        <div key={idx} className="flex gap-2 mb-1">
          <input placeholder={t("navi.competitor_name")} value={c.name} onChange={(e) => onChange(competitors.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
            className="flex-1 bg-transparent border rounded px-2 py-1 text-xs" style={{ borderColor: "#D3D8E4" }} />
          <input type="number" placeholder={t("navi.rx_week")} value={c.rx_per_week} onChange={(e) => onChange(competitors.map((x, i) => i === idx ? { ...x, rx_per_week: e.target.value } : x))}
            className="w-24 bg-transparent border rounded px-2 py-1 text-xs font-mono" style={{ borderColor: "#D3D8E4" }} />
          <button type="button" onClick={() => onChange(competitors.filter((_, i) => i !== idx))} className="text-xs px-2" style={{ color: "#DC2626" }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...competitors, { name: "", rx_per_week: "" }])} className="text-xs" style={{ color: "#ED3237" }}>+ {t("navi.add_competitor")}</button>
    </div>
  );
}

function PreVisitForm({ portfolioProducts, doctorProducts, onStarted }) {
  const { t } = useLanguage();
  const [goal, setGoal] = useState("");
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function addProduct() {
    setProducts((p) => [...p, { product_id: "", current_rx_per_week: "", potential_per_week: "", competitors: [], target_rx_per_week: "" }]);
  }
  function updateProduct(idx, patch) {
    setProducts((p) => p.map((row, i) => {
      if (i !== idx) return row;
      const next = { ...row, ...patch };
      if (patch.product_id) {
        const existing = doctorProducts.find((dp) => String(dp.product_id) === String(patch.product_id));
        if (existing && !row.current_rx_per_week) next.current_rx_per_week = existing.prescriptions;
      }
      return next;
    }));
  }

  async function submit() {
    setBusy(true); setError("");
    try {
      const payload = {
        visit_goal: goal,
        products: products.filter((p) => p.product_id).map((p) => ({
          product_id: p.product_id, current_rx_per_week: Number(p.current_rx_per_week) || 0,
          potential_per_week: Number(p.potential_per_week) || 0, target_rx_per_week: Number(p.target_rx_per_week) || 0,
          competitors: p.competitors.filter((c) => c.name).map((c) => ({ name: c.name, rx_per_week: Number(c.rx_per_week) || 0 })),
        })),
      };
      await onStarted(payload);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl p-5 mb-6" style={{ background: "linear-gradient(135deg,#EEF1F8,#F7F8FC)", border: "1px solid #E4E7F0" }}>
      <img src="/navi.png" alt="NAVI" style={{ height: "112px", width: "auto" }} className="mb-3" />
      <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.visit_goal")}</div>
      <textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t("navi.visit_goal_placeholder")}
        className="w-full bg-transparent border rounded px-3 py-2 text-sm mb-4" style={{ borderColor: "#D3D8E4" }} />

      {products.map((row, idx) => (
        <div key={idx} className="rounded-xl p-3 mb-3" style={{ background: "#FFFFFF", border: "1px solid #E4E7F0" }}>
          <div className="grid sm:grid-cols-2 gap-2 mb-2">
            <select value={row.product_id} onChange={(e) => updateProduct(idx, { product_id: e.target.value })} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>{t("navi.select_brand")}</option>
              {portfolioProducts.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
            </select>
            <input type="number" placeholder={t("navi.current_rx")} value={row.current_rx_per_week} onChange={(e) => updateProduct(idx, { current_rx_per_week: e.target.value })}
              className="bg-transparent border rounded px-2 py-1.5 text-sm font-mono" style={{ borderColor: "#D3D8E4" }} />
            <input type="number" placeholder={t("navi.potential_week")} value={row.potential_per_week} onChange={(e) => updateProduct(idx, { potential_per_week: e.target.value })}
              className="bg-transparent border rounded px-2 py-1.5 text-sm font-mono" style={{ borderColor: "#D3D8E4" }} />
            <input type="number" placeholder={t("navi.target_rx")} value={row.target_rx_per_week} onChange={(e) => updateProduct(idx, { target_rx_per_week: e.target.value })}
              className="bg-transparent border rounded px-2 py-1.5 text-sm font-mono" style={{ borderColor: "#D3D8E4", color: "#ED3237" }} />
          </div>
          <CompetitorRows competitors={row.competitors} onChange={(c) => updateProduct(idx, { competitors: c })} t={t} />
          <button type="button" onClick={() => setProducts((p) => p.filter((_, i) => i !== idx))} className="text-xs mt-2" style={{ color: "#DC2626" }}>{t("navi.remove_brand")}</button>
        </div>
      ))}
      <button type="button" onClick={addProduct} className="text-sm px-3 py-1.5 rounded mb-4" style={{ background: "#E4E7F0" }}>+ {t("navi.add_brand")}</button>

      {error && <div className="text-sm mb-3" style={{ color: "#DC2626" }}>{error}</div>}
      {busy && (
        <div className="flex flex-col items-center mb-4">
          <img src="/navi.png" alt="NAVI" className="navi-thinking" style={{ height: "72px", width: "auto" }} />
          <div className="flex gap-1 mt-2">
            <span className="navi-dot" style={{ animationDelay: "0s" }} />
            <span className="navi-dot" style={{ animationDelay: "0.2s" }} />
            <span className="navi-dot" style={{ animationDelay: "0.4s" }} />
          </div>
        </div>
      )}
      <div>
        <button onClick={submit} disabled={busy} className="px-6 py-3 rounded-full font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>
          {busy ? t("navi.thinking") : t("navi.start_visit")}
        </button>
      </div>
    </div>
  );
}

function MaterialRecommendation({ title, imageUrl, isPdf, script, t }) {
  return (
    <div className="rounded-xl p-3 mb-3" style={{ background: "#EEF1F8" }}>
      <div className="text-xs uppercase font-semibold mb-2" style={{ color: "#ED3237" }}>{title}</div>
      <div className="flex flex-col sm:flex-row gap-3">
        {isPdf ? (
          <iframe src={imageUrl} title={title} style={{ width: "220px", height: "260px", border: "1px solid #D3D8E4" }} className="rounded-lg shrink-0" />
        ) : (
          <Lightbox src={imageUrl} alt={title}>
            <img src={imageUrl} alt={title} className="rounded-lg object-cover shrink-0" style={{ width: "180px", height: "auto" }} />
          </Lightbox>
        )}
        <div className="text-sm flex-1">{script}</div>
      </div>
    </div>
  );
}

function VisitCard({ visit, canEdit, portfolioProducts, onReported, t, isLatest }) {
  const [showAi, setShowAi] = useState(!!isLatest);
  const [editing, setEditing] = useState(!visit.mp_report && canEdit);
  const [report, setReport] = useState(visit.mp_report || "");
  const [brands, setBrands] = useState(visit.post_visit_brands && visit.post_visit_brands.length ? visit.post_visit_brands : []);
  const [agreements, setAgreements] = useState(visit.post_visit_agreements && visit.post_visit_agreements.length ? visit.post_visit_agreements : []);
  const [busy, setBusy] = useState(false);

  const sections = visit.ai_sections || {};
  const dt = new Date(visit.created_at);
  const dateStr = dt.toLocaleDateString("ru-RU") + " " + dt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  async function save() {
    setBusy(true);
    try {
      await api.reportNaviVisit(visit.id, {
        mp_report: report,
        post_visit_brands: brands.filter((b) => b.product_id).map((b) => ({ product_id: b.product_id, monthly_qty: Number(b.monthly_qty) || 0 })),
        post_visit_agreements: agreements.filter((a) => a.product_id).map((a) => ({ product_id: a.product_id, agreed_rx_per_week: Number(a.agreed_rx_per_week) || 0 })),
      });
      setEditing(false);
      onReported();
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-2xl p-4 mb-3" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <img src="/navi.png" alt="NAVI" style={{ height: "48px", width: "auto" }} />
          <div className="text-xs" style={{ color: "#6B7280" }}>{dateStr}</div>
        </div>
        <button onClick={() => setShowAi((v) => !v)} className="text-xs px-3 py-1 rounded-full" style={{ background: "#E4E7F0" }}>
          {showAi ? t("navi.hide") : t("navi.show")}
        </button>
      </div>

      {visit.visit_goal && <div className="text-sm mb-2"><span style={{ color: "#6B7280" }}>{t("navi.visit_goal")}:</span> {visit.visit_goal}</div>}

      {showAi && (
        <div className="mb-3">
          {SECTION_KEYS.map(([key, labelKey]) => sections[key] && (
            <div key={key} className="mb-3">
              <div className="text-xs uppercase font-semibold mb-1" style={{ color: "#ED3237" }}>{t(labelKey)}</div>
              <div className="text-sm rounded-lg p-2" style={{ background: "#EEF1F8", whiteSpace: "pre-wrap" }}>{sections[key]}</div>
            </div>
          ))}
          {visit.visual_aid_id && (
            <MaterialRecommendation title={t("navi.sec_visual_aid")} imageUrl={api.visualAidImageUrl(visit.visual_aid_id)} isPdf={false} script={sections.visual_aid_script} t={t} />
          )}
          {visit.promo_material_id && (
            <MaterialRecommendation title={t("navi.sec_promo_material")} imageUrl={api.promoMaterialFileUrl(visit.promo_material_id)} isPdf={visit.promo_material_is_pdf} script={sections.promo_material_script} t={t} />
          )}
        </div>
      )}

      {editing ? (
        <div className="pt-3 border-t" style={{ borderColor: "#E4E7F0" }}>
          <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.report_visit")}</div>
          <textarea rows={3} value={report} onChange={(e) => setReport(e.target.value)} placeholder={t("navi.report_placeholder")}
            className="w-full bg-transparent border rounded px-3 py-2 text-sm mb-3" style={{ borderColor: "#D3D8E4" }} />

          <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.actual_monthly_brands")}</div>
          {brands.map((b, idx) => (
            <div key={idx} className="flex gap-2 mb-1">
              <select value={b.product_id} onChange={(e) => setBrands((r) => r.map((x, i) => i === idx ? { ...x, product_id: e.target.value } : x))}
                className="flex-1 bg-transparent border rounded px-2 py-1 text-xs" style={{ borderColor: "#D3D8E4" }}>
                <option value="" style={{ color: "#000" }}>{t("navi.select_brand")}</option>
                {portfolioProducts.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
              </select>
              <input type="number" placeholder={t("navi.monthly_qty")} value={b.monthly_qty} onChange={(e) => setBrands((r) => r.map((x, i) => i === idx ? { ...x, monthly_qty: e.target.value } : x))}
                className="w-28 bg-transparent border rounded px-2 py-1 text-xs font-mono" style={{ borderColor: "#D3D8E4" }} />
              <button onClick={() => setBrands((r) => r.filter((_, i) => i !== idx))} className="text-xs px-2" style={{ color: "#DC2626" }}>✕</button>
            </div>
          ))}
          <button onClick={() => setBrands((r) => [...r, { product_id: "", monthly_qty: "" }])} className="text-xs mb-3" style={{ color: "#ED3237" }}>+ {t("navi.add_brand")}</button>

          <div className="text-xs uppercase mb-1 mt-2" style={{ color: "#6B7280" }}>{t("navi.agreements")}</div>
          {agreements.map((a, idx) => (
            <div key={idx} className="flex gap-2 mb-1">
              <select value={a.product_id} onChange={(e) => setAgreements((r) => r.map((x, i) => i === idx ? { ...x, product_id: e.target.value } : x))}
                className="flex-1 bg-transparent border rounded px-2 py-1 text-xs" style={{ borderColor: "#D3D8E4" }}>
                <option value="" style={{ color: "#000" }}>{t("navi.select_brand")}</option>
                {portfolioProducts.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
              </select>
              <input type="number" placeholder={t("navi.rx_week")} value={a.agreed_rx_per_week} onChange={(e) => setAgreements((r) => r.map((x, i) => i === idx ? { ...x, agreed_rx_per_week: e.target.value } : x))}
                className="w-28 bg-transparent border rounded px-2 py-1 text-xs font-mono" style={{ borderColor: "#D3D8E4" }} />
              <button onClick={() => setAgreements((r) => r.filter((_, i) => i !== idx))} className="text-xs px-2" style={{ color: "#DC2626" }}>✕</button>
            </div>
          ))}
          <button onClick={() => setAgreements((r) => [...r, { product_id: "", agreed_rx_per_week: "" }])} className="text-xs mb-3 block" style={{ color: "#ED3237" }}>+ {t("navi.add_brand")}</button>

          <button onClick={save} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("navi.save_visit")}</button>
        </div>
      ) : (
        <div className="pt-3 border-t text-sm" style={{ borderColor: "#E4E7F0" }}>
          {visit.mp_report && <div className="mb-2">{visit.mp_report}</div>}
          {canEdit && <button onClick={() => setEditing(true)} className="text-xs" style={{ color: "#ED3237" }}>{t("common.change")}</button>}
        </div>
      )}
    </div>
  );
}

export default function NaviDoctorDetail({ doctorId, user, onBack }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);
  const [portfolioProducts, setPortfolioProducts] = useState([]);
  const [error, setError] = useState("");
  const [showPreVisit, setShowPreVisit] = useState(false);

  async function load() {
    setError("");
    try {
      setData(await api.getNaviDoctor(doctorId));
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => { load(); api.listPortfolio().then(setPortfolioProducts); }, [doctorId]);

  if (error && !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8">
        <button onClick={onBack} className="text-sm mb-4" style={{ color: "#6B7280" }}>← {t("common.back")}</button>
        <div className="text-sm px-3 py-2 rounded" style={{ background: "#DC262622", color: "#DC2626" }}>{error}</div>
      </div>
    );
  }
  if (!data) return <div className="p-8" style={{ color: "#6B7280" }}>{t("common.loading")}</div>;

  async function startVisit(payload) {
    setError("");
    try {
      await api.startNaviVisit(doctorId, { ...payload, lang });
      setShowPreVisit(false);
      await load();
    } catch (e) { setError(e.message); throw e; }
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

      {canEdit && !showPreVisit && (
        <div className="rounded-2xl p-5 mb-6 text-center" style={{ background: "linear-gradient(135deg,#EEF1F8,#F7F8FC)", border: "1px solid #E4E7F0" }}>
          <img src="/navi.png" alt="NAVI" style={{ height: "128px", width: "auto" }} className="mx-auto mb-2" />
          <div className="text-sm mb-3" style={{ color: "#6B7280" }}>{t("navi.start_visit_hint")}</div>
          <button onClick={() => setShowPreVisit(true)} className="px-6 py-3 rounded-full font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>
            {t("navi.start_visit")}
          </button>
        </div>
      )}

      {canEdit && showPreVisit && (
        <PreVisitForm portfolioProducts={portfolioProducts} doctorProducts={data.products.map((p) => ({ product_id: p.product_id, prescriptions: p.prescriptions }))} onStarted={startVisit} />
      )}
      {error && <div className="text-sm mb-4" style={{ color: "#DC2626" }}>{error}</div>}

      <div className="font-display text-lg mb-3">{t("navi.visit_history")}</div>
      {data.visits.map((v, idx) => <VisitCard key={v.id} visit={v} canEdit={canEdit} portfolioProducts={portfolioProducts} onReported={load} t={t} isLatest={idx === 0} />)}
      {data.visits.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("navi.no_visits")}</div>}
    </div>
  );
}
