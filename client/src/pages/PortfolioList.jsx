import React, { useEffect, useState } from "react";
import { api, authedDownload } from "../api.js";
import PortfolioDetail from "./PortfolioDetail.jsx";

function AddProductForm({ user, groups, onCreated }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nrv, setNrv] = useState("");
  const [groupId, setGroupId] = useState(user.group_id || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { setError("Укажите название"); return; }
    setBusy(true); setError("");
    try {
      await api.createPortfolioItem({ name: name.trim(), nrv_usd: Number(nrv) || 0, group_id: user.role === "bm" ? undefined : groupId });
      setName(""); setNrv(""); setOpen(false);
      onCreated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="px-5 py-2.5 rounded font-semibold mb-6" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ Добавить препарат</button>;

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">Новый препарат</div>
      <div className="grid sm:grid-cols-3 gap-2 text-sm mb-3">
        <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder="Цена NRV, $" type="number" value={nrv} onChange={(e) => setNrv(e.target.value)} className="bg-transparent border rounded px-3 py-2 font-mono" style={{ borderColor: "#D3D8E4" }} />
        {user.role !== "bm" && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
            <option value="" style={{ color: "#000" }}>Группа</option>
            {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
          </select>
        )}
      </div>
      {error && <div className="text-sm mb-2" style={{ color: "#DC2626" }}>{error}</div>}
      <div className="flex gap-3">
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить</button>
        <button onClick={() => setOpen(false)} className="px-4 py-2 rounded" style={{ background: "#E4E7F0" }}>Отмена</button>
      </div>
    </div>
  );
}

export default function PortfolioList({ user }) {
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setItems(await api.listPortfolio());
    setGroups(await api.listGroups());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (selectedId) return <PortfolioDetail productId={selectedId} user={user} onBack={() => { setSelectedId(null); load(); }} />;

  const canAdd = user.role === "master" || user.role === "bm";
  const byGroup = {};
  for (const it of items) {
    const key = it.group_name || "Без группы";
    (byGroup[key] ||= []).push(it);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="font-display text-2xl font-semibold">Портфолио</div>
        <button onClick={() => authedDownload(api.portfolioAllBrochureUrl())} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>Скачать всю брошюру (PDF)</button>
      </div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>Карточки препаратов: материалы, ключевые сообщения, конкуренты</div>

      {canAdd && <AddProductForm user={user} groups={groups} onCreated={load} />}

      {loading ? <div style={{ color: "#6B7280" }}>Загрузка…</div> : (
        Object.entries(byGroup).map(([groupName, groupItems]) => (
          <div key={groupName} className="mb-6">
            <div className="text-sm uppercase tracking-wide mb-2" style={{ color: "#ED3237" }}>{groupName}</div>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {groupItems.map((it) => (
                <button key={it.id} onClick={() => setSelectedId(it.id)} className="text-left rounded-2xl p-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
                  <div className="font-semibold">{it.name}</div>
                  <div className="text-xs mt-1 font-mono" style={{ color: "#6B7280" }}>${Number(it.nrv_usd).toFixed(2)}</div>
                  <div className="flex gap-2 mt-2 text-xs">
                    <span style={{ color: it.pil_count > 0 ? "#16A34A" : "#9CA3AF" }}>PIL {it.pil_count > 0 ? "✓" : "—"}</span>
                    <span style={{ color: it.slides_count > 0 ? "#16A34A" : "#9CA3AF" }}>Слайды {it.slides_count > 0 ? "✓" : "—"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {!loading && items.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Пока нет ни одного препарата в вашей группе</div>}
    </div>
  );
}
