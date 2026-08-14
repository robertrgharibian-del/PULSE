import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import DoctorDetail from "./DoctorDetail.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function AddDoctorForm({ onCreated }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", specialty: "", city: "", clinic: "", contact: "", trip_start: "", trip_end: "", event_name: "", event_city: "" });
  const [pharmacies, setPharmacies] = useState(Array.from({ length: 10 }, () => ({ name: "", address: "" })));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError("");
    try {
      await api.createTrackedDoctor({ ...form, pharmacies: pharmacies.filter((p) => p.name.trim()) });
      setForm({ full_name: "", specialty: "", city: "", clinic: "", contact: "", trip_start: "", trip_end: "", event_name: "", event_city: "" });
      setPharmacies(Array.from({ length: 10 }, () => ({ name: "", address: "" })));
      setOpen(false);
      onCreated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="px-5 py-2.5 rounded font-semibold mb-6" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ {t("doctracking.add_doctor")}</button>;
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">{t("doctracking.new_doctor")}</div>
      <div className="grid sm:grid-cols-2 gap-3 text-sm mb-4">
        <input placeholder={t("doctracking.full_name")} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <select value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
          <option value="" style={{ color: "#000" }}>{t("doctracking.specialty")}</option>
          <option value="Кардиолог" style={{ color: "#000" }}>{t("doctracking.cardiologist")}</option>
          <option value="Интервенционист" style={{ color: "#000" }}>{t("doctracking.interventionist")}</option>
        </select>
        <input placeholder={t("doctracking.city")} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("doctracking.clinic")} value={form.clinic} onChange={(e) => setForm({ ...form, clinic: e.target.value })} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("doctracking.contact")} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="bg-transparent border rounded px-3 py-2 sm:col-span-2" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("doctracking.event_name")} value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("doctracking.event_city")} value={form.event_city} onChange={(e) => setForm({ ...form, event_city: e.target.value })} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <label className="text-xs" style={{ color: "#6B7280" }}>{t("doctracking.trip_start")}
          <input type="date" value={form.trip_start} onChange={(e) => setForm({ ...form, trip_start: e.target.value })} className="w-full bg-transparent border rounded px-3 py-2 mt-1" style={{ borderColor: "#D3D8E4" }} />
        </label>
        <label className="text-xs" style={{ color: "#6B7280" }}>{t("doctracking.trip_end")}
          <input type="date" value={form.trip_end} onChange={(e) => setForm({ ...form, trip_end: e.target.value })} className="w-full bg-transparent border rounded px-3 py-2 mt-1" style={{ borderColor: "#D3D8E4" }} />
        </label>
      </div>

      <div className="text-xs uppercase mb-2" style={{ color: "#6B7280" }}>{t("doctracking.pharmacies_10")}</div>
      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        {pharmacies.map((p, idx) => (
          <div key={idx} className="flex gap-2">
            <input placeholder={`${t("doctracking.pharmacy")} ${idx + 1}`} value={p.name} onChange={(e) => setPharmacies((arr) => arr.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
              className="flex-1 bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
            <input placeholder={t("doctracking.address")} value={p.address} onChange={(e) => setPharmacies((arr) => arr.map((x, i) => i === idx ? { ...x, address: e.target.value } : x))}
              className="flex-1 bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
          </div>
        ))}
      </div>

      {error && <div className="text-sm mb-3" style={{ color: "#DC2626" }}>{error}</div>}
      <div className="flex gap-3">
        <button onClick={submit} disabled={busy} className="px-5 py-2.5 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{busy ? t("profile.saving") : t("doctracking.save_doctor")}</button>
        <button onClick={() => setOpen(false)} className="px-4 py-2.5 rounded" style={{ background: "#E4E7F0" }}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

export default function DocTrackingList({ user }) {
  const { t } = useLanguage();
  const [doctors, setDoctors] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setDoctors(await api.listTrackedDoctors());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (selectedId) return <DoctorDetail doctorId={selectedId} user={user} onBack={() => { setSelectedId(null); load(); }} />;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">{t("nav.doctracking")}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("doctracking.subtitle")}</div>

      {user.role === "mp" && <AddDoctorForm onCreated={load} />}

      {loading ? <div style={{ color: "#6B7280" }}>{t("common.loading")}</div> : (
        <div className="space-y-2">
          {doctors.map((d) => (
            <button key={d.id} onClick={() => setSelectedId(d.id)} className="w-full text-left rounded-2xl p-4 flex flex-wrap items-center justify-between gap-2" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
              <div>
                <div className="font-semibold">{d.full_name}</div>
                <div className="text-xs" style={{ color: "#6B7280" }}>{d.specialty || "—"} · {d.city || "—"} {user.role !== "mp" && `· ${d.mp_name}`}</div>
              </div>
              <div className="text-xs" style={{ color: "#6B7280" }}>{d.event_name || "—"}</div>
            </button>
          ))}
          {doctors.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("doctracking.empty")}</div>}
        </div>
      )}
    </div>
  );
}
