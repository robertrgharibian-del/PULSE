import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import NaviDoctorDetail from "./NaviDoctorDetail.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const PSYCHOTYPES_RU = ["Доминирующий (быстро принимает решения)", "Влияющий (общительный, эмоциональный)", "Постоянный (осторожный, ценит отношения)", "Аналитический (нужны факты и данные)"];
const PSYCHOTYPES_UZ = ["Dominant (tez qaror qabul qiladi)", "Ta'sirchan (muloqotchan, hissiy)", "Barqaror (ehtiyotkor, munosabatni qadrlaydi)", "Analitik (fakt va ma'lumot kerak)"];

function AddDoctorForm({ portfolioProducts, onCreated }) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ last_name: "", first_name: "", patronymic: "", city: "", lpu: "", specialty: "", experience_years: "", psychotype: "", visit_minutes: "", needs: "", behavior: "" });
  const [prescriptions, setPrescriptions] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const psychotypes = lang === "uz" ? PSYCHOTYPES_UZ : PSYCHOTYPES_RU;

  async function submit() {
    if (!form.last_name.trim()) { setError(t("navi.err_last_name")); return; }
    setBusy(true); setError("");
    try {
      const products = Object.entries(prescriptions).filter(([, v]) => v).map(([product_id, prescriptions]) => ({ product_id, prescriptions: Number(prescriptions) || 0 }));
      await api.createNaviDoctor({ ...form, experience_years: Number(form.experience_years) || null, visit_minutes: Number(form.visit_minutes) || null, products });
      setForm({ last_name: "", first_name: "", patronymic: "", city: "", lpu: "", specialty: "", experience_years: "", psychotype: "", visit_minutes: "", needs: "", behavior: "" });
      setPrescriptions({});
      setOpen(false);
      onCreated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="px-5 py-2.5 rounded font-semibold mb-6" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ {t("navi.add_doctor")}</button>;

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">{t("navi.new_doctor")}</div>
      <div className="grid sm:grid-cols-3 gap-2 mb-3 text-sm">
        <input placeholder={t("navi.last_name")} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("navi.first_name")} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("navi.patronymic")} value={form.patronymic} onChange={(e) => setForm({ ...form, patronymic: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("doctracking.city")} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("navi.lpu")} value={form.lpu} onChange={(e) => setForm({ ...form, lpu: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        <select value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
          <option value="" style={{ color: "#000" }}>{t("doctracking.specialty")}</option>
          {["Кардиолог", "ВОП", "Терапевт", "Интервенционист", "Эндокринолог", "ЛОР", "Педиатр", "Аллерголог", "Пульмонолог", "Провизор"].map((s) => <option key={s} value={s} style={{ color: "#000" }}>{s}</option>)}
        </select>
        <input type="number" placeholder={t("navi.experience")} value={form.experience_years} onChange={(e) => setForm({ ...form, experience_years: e.target.value })} className="bg-transparent border rounded px-2 py-1.5 font-mono" style={{ borderColor: "#D3D8E4" }} />
        <select value={form.psychotype} onChange={(e) => setForm({ ...form, psychotype: e.target.value })} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-2" style={{ borderColor: "#D3D8E4" }}>
          <option value="" style={{ color: "#000" }}>{t("navi.psychotype")}</option>
          {psychotypes.map((p) => <option key={p} value={p} style={{ color: "#000" }}>{p}</option>)}
        </select>
        <input type="number" placeholder={t("navi.visit_minutes")} value={form.visit_minutes} onChange={(e) => setForm({ ...form, visit_minutes: e.target.value })} className="bg-transparent border rounded px-2 py-1.5 font-mono sm:col-span-3" style={{ borderColor: "#D3D8E4" }} />
        <textarea rows={2} placeholder={t("navi.needs")} value={form.needs} onChange={(e) => setForm({ ...form, needs: e.target.value })} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-3" style={{ borderColor: "#D3D8E4" }} />
        <textarea rows={2} placeholder={t("navi.behavior")} value={form.behavior} onChange={(e) => setForm({ ...form, behavior: e.target.value })} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-3" style={{ borderColor: "#D3D8E4" }} />
      </div>

      {portfolioProducts.length > 0 && (
        <div className="mb-3">
          <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{t("navi.prescribes")}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {portfolioProducts.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{p.name}</span>
                <input type="number" placeholder="0" value={prescriptions[p.id] || ""} onChange={(e) => setPrescriptions((s) => ({ ...s, [p.id]: e.target.value }))}
                  className="w-20 bg-transparent border rounded px-2 py-1 font-mono text-xs" style={{ borderColor: "#D3D8E4" }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.save")}</button>
        <button onClick={() => setOpen(false)} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

export default function NaviList({ user }) {
  const { t } = useLanguage();
  const [doctors, setDoctors] = useState([]);
  const [search, setSearch] = useState("");
  const [portfolioProducts, setPortfolioProducts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState("");
  async function load() {
    setLoading(true); setLoadError("");
    try {
      setDoctors(await api.listNaviDoctors(search));
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [search]);
  useEffect(() => { api.listPortfolio().then(setPortfolioProducts); }, []);

  if (selectedId) return <NaviDoctorDetail doctorId={selectedId} user={user} onBack={() => { setSelectedId(null); load(); }} />;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex items-center gap-3 mb-1">
        <img src="/navi.png" alt="NAVI" style={{ height: "104px", width: "auto" }} />
        <div>
          <div className="font-display text-2xl font-semibold">NAVI</div>
          <div className="text-sm" style={{ color: "#6B7280" }}>{t("navi.subtitle")}</div>
        </div>
      </div>

      <input placeholder={t("navi.search_placeholder")} value={search} onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-transparent border rounded px-3 py-2 text-sm my-4" style={{ borderColor: "#D3D8E4" }} />

      {user.role === "mp" && <AddDoctorForm portfolioProducts={portfolioProducts} onCreated={load} />}

      {loadError && <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#DC262622", color: "#DC2626" }}>{loadError}</div>}
      {loading ? <div style={{ color: "#6B7280" }}>{t("common.loading")}</div> : (
        <div className="space-y-2">
          {doctors.map((d) => (
            <button key={d.id} onClick={() => setSelectedId(d.id)} className="w-full text-left rounded-2xl p-4 flex flex-wrap items-center justify-between gap-2" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
              <div>
                <div className="font-semibold">{d.last_name} {d.first_name}</div>
                <div className="text-xs" style={{ color: "#6B7280" }}>{d.specialty || "—"} · {d.lpu || "—"} · {d.city || "—"} {user.role !== "mp" && `· ${d.mp_name}`}</div>
              </div>
              <div className="text-xs" style={{ color: "#ED3237" }}>{t("navi.visits_count", { n: d.visit_count })}</div>
            </button>
          ))}
          {doctors.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("navi.empty")}</div>}
        </div>
      )}
    </div>
  );
}
