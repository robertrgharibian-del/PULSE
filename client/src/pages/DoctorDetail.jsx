import React, { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api.js";

export default function DoctorDetail({ doctorId, user, onBack }) {
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

  if (!data) return <div className="p-8" style={{ color: "#8493AA" }}>Загрузка…</div>;

  async function addLog() {
    if (!productId || !logDate) { setError("Укажите дату и препарат"); return; }
    setBusy(true); setError("");
    try {
      await api.addDoctorLog(doctorId, { log_date: logDate, pharmacy_id: pharmacyId || null, product_id: productId, qty_packages: Number(qty) || 0 });
      setQty(""); setPharmacyId(""); setProductId("");
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function removeLog(id) {
    if (!confirm("Удалить запись?")) return;
    try { await api.deleteDoctorLog(id); await load(); } catch (e) { setError(e.message); }
  }

  const monthNames = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  const chartData = data.monthly.map((m) => ({ period: `${monthNames[m.month - 1]} ${m.year}`, USD: Math.round(m.usd) }));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#8493AA" }}>← Назад к списку</button>

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
        <div className="font-display text-2xl font-semibold mb-1">{data.doctor.full_name}</div>
        <div className="text-sm mb-3" style={{ color: "#8493AA" }}>
          {data.doctor.specialty || "—"} · {data.doctor.city || "—"} · {data.doctor.clinic || "—"}
        </div>
        <div className="text-xs" style={{ color: "#8493AA" }}>
          Конференция: <b style={{ color: "#C9D2E0" }}>{data.doctor.event_name || "—"}</b> ({data.doctor.event_city || "—"})
          {data.doctor.trip_start && <> · {String(data.doctor.trip_start).slice(0, 10)} — {String(data.doctor.trip_end || "").slice(0, 10)}</>}
        </div>
        <div className="mt-3 font-mono text-lg font-bold" style={{ color: "#E8B04B" }}>Общий вклад: ${Math.round(data.total_usd).toLocaleString()}</div>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-2xl p-4 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#8493AA" }}>Вклад по месяцам, $</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#22304A" vertical={false} />
              <XAxis dataKey="period" stroke="#8493AA" fontSize={11} />
              <YAxis stroke="#8493AA" fontSize={11} />
              <Tooltip contentStyle={{ background: "#0E1726", border: "1px solid #3A4A66", borderRadius: 8, color: "#F5F0E6" }} />
              <Bar dataKey="USD" fill="#E8B04B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
        <div className="font-display text-lg mb-3">10 индикаторных аптек</div>
        <div className="grid sm:grid-cols-2 gap-2 text-sm">
          {data.pharmacies.map((p) => (
            <div key={p.id} className="rounded-lg px-3 py-2" style={{ background: "#1B2A44" }}>{p.name}{p.address ? ` · ${p.address}` : ""}</div>
          ))}
          {data.pharmacies.length === 0 && <div style={{ color: "#8493AA" }}>Аптеки не заданы</div>}
        </div>
      </div>

      {canEdit && (
        <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
          <div className="font-display text-lg mb-3">Добавить запись контроля</div>
          <div className="grid sm:grid-cols-4 gap-2 text-sm mb-3">
            <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#3A4A66" }} />
            <select value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#3A4A66" }}>
              <option value="" style={{ color: "#000" }}>Аптека</option>
              {data.pharmacies.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
            </select>
            <select value={productId} onChange={(e) => setProductId(e.target.value)} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#3A4A66" }}>
              <option value="" style={{ color: "#000" }}>Препарат</option>
              {products.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.name}</option>)}
            </select>
            <input type="number" placeholder="Кол-во уп." value={qty} onChange={(e) => setQty(e.target.value)} className="bg-transparent border rounded px-2 py-2 font-mono" style={{ borderColor: "#3A4A66" }} />
          </div>
          {error && <div className="text-sm mb-2" style={{ color: "#E2574C" }}>{error}</div>}
          <button onClick={addLog} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>Добавить</button>
        </div>
      )}

      <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#141F33", border: "1px solid #22304A" }}>
        <div className="font-display text-lg mb-3">Лог контроля</div>
        <div className="space-y-2">
          {data.log.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#1B2A44" }}>
              <div>{String(l.log_date).slice(0, 10)} · {l.pharmacy_name || "—"} · {l.product_name} · {l.qty_packages} уп.</div>
              <div className="flex items-center gap-2">
                <span className="font-mono" style={{ color: "#E8B04B" }}>${Math.round(l.usd).toLocaleString()}</span>
                {canEdit && <button onClick={() => removeLog(l.id)} className="text-xs" style={{ color: "#E2574C" }}>Удалить</button>}
              </div>
            </div>
          ))}
          {data.log.length === 0 && <div className="text-sm" style={{ color: "#8493AA" }}>Записей пока нет</div>}
        </div>
      </div>
    </div>
  );
}
