import React, { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { api } from "../api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function DoctorDetail({ doctorId, user, onBack }) {
  const { t, lang } = useLanguage();
  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [pharmacyId, setPharmacyId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");

  async function load() {
    const d = await api.getTrackedDoctor(doctorId);
    setData(d);
  }
  useEffect(() => { load(); api.listProducts().then(setProducts); }, [doctorId]);

  const canEdit = data ? user.role === "mp" && data.doctor.mp_id === user.id : false;

  if (!data) return <div className="p-8" style={{ color: "#6B7280" }}>{t("common.loading")}</div>;

  async function addLog() {
    if (!productId || !logDate) { setError(t("doctordetail.err_date_product")); return; }
    setBusy(true); setError("");
    try {
      await api.addDoctorLog(doctorId, { log_date: logDate, pharmacy_id: pharmacyId || null, product_id: productId, qty_packages: Number(qty) || 0 });
      setQty(""); setPharmacyId(""); setProductId("");
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function removeLog(id) {
    if (!confirm(t("common.confirm_delete"))) return;
    try { await api.deleteDoctorLog(id); await load(); } catch (e) { setError(e.message); }
  }

  const monthNames = lang === "uz"
    ? ["Yan", "Fev", "Mar", "Apr", "May", "Iyun", "Iyul", "Avg", "Sen", "Okt", "Noy", "Dek"]
    : ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const chartData = data.monthly.map((m) => ({ period: `${monthNames[m.month - 1]} ${m.year}`, USD: Math.round(m.usd) }));

  const PHARM_COLORS = ["#ED3237", "#3E4095", "#16A34A", "#7C3AED", "#C58A1F", "#0EA5E9", "#DB2777", "#059669"];
  const pharmacyList = data.pharmacyMonthly || [];
  const periodKeySet = new Map();
  pharmacyList.forEach((p) => p.months.forEach((m) => {
    const key = `${m.year}-${m.month}`;
    if (!periodKeySet.has(key)) periodKeySet.set(key, { year: m.year, month: m.month, period: `${monthNames[m.month - 1]} ${m.year}` });
  }));
  const sortedPeriods = [...periodKeySet.values()].sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const pharmacyChartData = sortedPeriods.map((p) => {
    const row = { period: p.period };
    pharmacyList.forEach((ph) => {
      const found = ph.months.find((m) => m.year === p.year && m.month === p.month);
      row[ph.pharmacy_name] = found ? Math.round(found.usd) : 0;
    });
    return row;
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#6B7280" }}>← {t("common.back")}</button>

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-2xl font-semibold mb-1">{data.doctor.full_name}</div>
        <div className="text-sm mb-3" style={{ color: "#6B7280" }}>
          {data.doctor.specialty || "—"} · {data.doctor.city || "—"} · {data.doctor.clinic || "—"}
        </div>
        <div className="text-xs" style={{ color: "#6B7280" }}>
          {t("doctordetail.conference")}: <b style={{ color: "#374151" }}>{data.doctor.event_name || "—"}</b> ({data.doctor.event_city || "—"})
          {data.doctor.trip_start && <> · {String(data.doctor.trip_start).slice(0, 10)} — {String(data.doctor.trip_end || "").slice(0, 10)}</>}
        </div>
        <div className="mt-3 font-mono text-lg font-bold" style={{ color: "#ED3237" }}>{t("doctordetail.total_contribution")}: ${Math.round(data.total_usd).toLocaleString()}</div>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-2xl p-4 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#6B7280" }}>{t("doctordetail.contribution_by_month")}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E7F0" vertical={false} />
              <XAxis dataKey="period" stroke="#6B7280" fontSize={11} />
              <YAxis stroke="#6B7280" fontSize={11} />
              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #D3D8E4", borderRadius: 8, color: "#1F2937" }} />
              <Bar dataKey="USD" fill="#ED3237" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {pharmacyChartData.length > 0 && (
        <div className="rounded-2xl p-4 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#6B7280" }}>{t("doctordetail.dynamics_by_pharmacy")}</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={pharmacyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E4E7F0" vertical={false} />
              <XAxis dataKey="period" stroke="#6B7280" fontSize={11} />
              <YAxis stroke="#6B7280" fontSize={11} />
              <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #D3D8E4", borderRadius: 8, color: "#1F2937" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {pharmacyList.map((ph, i) => (
                <Line key={ph.pharmacy_name} type="monotone" dataKey={ph.pharmacy_name} stroke={PHARM_COLORS[i % PHARM_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="grid sm:grid-cols-2 gap-2 mt-3 text-xs">
            {pharmacyList.map((ph, i) => (
              <div key={ph.pharmacy_name} className="flex items-center justify-between rounded px-2 py-1" style={{ background: "#EEF1F8" }}>
                <span><span style={{ color: PHARM_COLORS[i % PHARM_COLORS.length] }}>●</span> {ph.pharmacy_name}</span>
                <span className="font-mono" style={{ color: "#ED3237" }}>${Math.round(ph.total_usd).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">{t("doctordetail.indicator_pharmacies")}</div>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          {data.pharmacies.map((p) => (
            <div key={p.id} className="rounded-lg px-3 py-2" style={{ background: "#EEF1F8" }}>{p.name}{p.address ? ` · ${p.address}` : ""}</div>
          ))}
          {data.pharmacies.length === 0 && <div style={{ color: "#6B7280" }}>{t("doctordetail.no_pharmacies")}</div>}
        </div>
      </div>

      {canEdit && (
        <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="font-display text-lg mb-3">{t("doctordetail.add_log_entry")}</div>
          <div className="grid sm:grid-cols-4 gap-2 text-sm mb-3">
            <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#D3D8E4" }} />
            <select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>{t("doctordetail.pharmacy")}</option>
              {data.pharmacies.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
            </select>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>{t("doctordetail.product")}</option>
              {products.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
            </select>
            <input type="number" placeholder={t("doctordetail.qty_packages")} value={qty} onChange={(e) => setQty(e.target.value)} className="bg-transparent border rounded px-2 py-2 font-mono" style={{ borderColor: "#D3D8E4" }} />
          </div>
          {error && <div className="text-sm mb-2" style={{ color: "#DC2626" }}>{error}</div>}
          <button onClick={addLog} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.add")}</button>
        </div>
      )}

      <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">{t("doctordetail.control_log")}</div>
        <div className="space-y-2">
          {data.log.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#EEF1F8" }}>
              <div>{String(l.log_date).slice(0, 10)} · {l.pharmacy_name || "—"} · {l.product_name} · {l.qty_packages} {t("doctordetail.pack_short")}</div>
              <div className="flex items-center gap-2">
                <span className="font-mono" style={{ color: "#ED3237" }}>${Math.round(l.usd).toLocaleString()}</span>
                {canEdit && <button onClick={() => removeLog(l.id)} className="text-xs" style={{ color: "#DC2626" }}>{t("common.delete")}</button>}
              </div>
            </div>
          ))}
          {data.log.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("doctordetail.no_entries")}</div>}
        </div>
      </div>
    </div>
  );
}
