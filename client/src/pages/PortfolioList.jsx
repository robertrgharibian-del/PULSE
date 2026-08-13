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

  if (!open) return <button onClick={() => setOpen(true)} className="px-5 py-2.5 rounded font-semibold mb-6" style={{ background: "#E8B04B", color: "#0E1726" }}>+ Добавить препарат</button>;

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
      <div className="font-display text-lg mb-3">Новый препарат</div>
      <div className="grid sm:grid-cols-3 gap-2 text-sm mb-3">
        <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
        <input placeholder="Цена NRV, $" type="number" value={nrv} onChange={(e) => setNrv(e.target.value)} className="bg-transparent border rounded px-3 py-2 font-mono" style={{ borderColor: "#3A4A66" }} />
        {user.role !== "bm" && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }}>
            <option value="" style={{ color: "#000" }}>Группа</option>
            {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
          </select>
        )}
      </div>
      {error && <div className="text-sm mb-2" style={{ color: "#E2574C" }}>{error}</div>}
      <div className="flex gap-3">
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>Сохранить</button>
        <button onClick={() => setOpen(false)} className="px-4 py-2 rounded" style={{ background: "#22304A" }}>Отмена</button>
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
        <button onClick={() => authedDownload(api.portfolioAllBrochureUrl())} className="px-4 py-2 rounded text-sm" style={{ background: "#22304A" }}>Скачать всю брошюру (PDF)</button>
      </div>
      <div className="text-sm mb-6" style={{ color: "#8493AA" }}>Карточки препаратов: материалы, ключевые сообщения, конкуренты</div>

      {canAdd && <AddProductForm user={user} groups={groups} onCreated={load} />}

      {loading ? <div style={{ color: "#8493AA" }}>Загрузка…</div> : (
        Object.entries(byGroup).map(([groupName, groupItems]) => (
          <div key={groupName} className="mb-6">
            <div className="text-sm uppercase tracking-wide mb-2" style={{ color: "#E8B04B" }}>{groupName}</div>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {groupItems.map((it) => (
                <button key={it.id} onClick={() => setSelectedId(it.id)} className="text-left rounded-2xl p-4" style={{ background: "#141F33", border: "1px solid #22304A" }}>
                  <div className="font-semibold">{it.name}</div>
                  <div className="text-xs mt-1 font-mono" style={{ color: "#8493AA" }}>${Number(it.nrv_usd).toFixed(2)}</div>
                  <div className="flex gap-2 mt-2 text-xs">
                    <span style={{ color: it.pil_count > 0 ? "#3FB88F" : "#4A5A76" }}>PIL {it.pil_count > 0 ? "✓" : "—"}</span>
                    <span style={{ color: it.slides_count > 0 ? "#3FB88F" : "#4A5A76" }}>Слайды {it.slides_count > 0 ? "✓" : "—"}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {!loading && items.length === 0 && <div className="text-sm" style={{ color: "#8493AA" }}>Пока нет ни одного препарата в вашей группе</div>}
    </div>
  );
}
