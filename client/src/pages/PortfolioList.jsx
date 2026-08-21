import React, { useEffect, useState } from "react";
import { api, authedDownload } from "../api.js";
import PortfolioDetail from "./PortfolioDetail.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

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

  if (!open) return <button onClick={() => setOpen(true)} className="px-5 py-2.5 rounded font-semibold mb-4" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ Добавить SKU</button>;

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">Новый SKU</div>
      <div className="grid sm:grid-cols-3 gap-2 text-sm mb-3">
        <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder="Цена NRV, $" type="number" value={nrv} onChange={(e) => setNrv(e.target.value)} className="bg-transparent border rounded px-3 py-2 font-mono" style={{ borderColor: "#D3D8E4" }} />
        {user.role !== "bm" && (
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
            <option value="" style={{ color: "#000" }}>Команда</option>
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

function BrandManager({ user, groups, brands, onChanged }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(user.role === "bm" ? user.group_id : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setBusy(true); setError("");
    try {
      await api.createBrand(name.trim(), user.role === "bm" ? undefined : (groupId || null));
      setName(""); setOpen(false); onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(b) {
    if (!confirm(t("brands.confirm_delete", { name: b.name }))) return;
    try { await api.deleteBrand(b.id); onChanged(); } catch (e) { setError(e.message); }
  }

  async function relink(b, newGroupId) {
    try { await api.updateBrand(b.id, { group_id: newGroupId || null }); onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-1">{t("brands.title")}</div>
      <div className="text-xs mb-3" style={{ color: "#6B7280" }}>{t("brands.subtitle")}</div>

      <div className="space-y-2 mb-3">
        {brands.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg p-2 text-sm" style={{ background: "#EEF1F8" }}>
            <span className="font-semibold flex-1 min-w-[120px]">{b.name}</span>
            <span className="text-xs" style={{ color: "#6B7280" }}>{b.sku_count} {t("brands.sku_count")}</span>
            {user.role === "master" ? (
              <select value={b.group_id || ""} onChange={(e) => relink(b, e.target.value)} className="bg-transparent border rounded px-2 py-1 text-xs" style={{ borderColor: "#D3D8E4" }}>
                <option value="" style={{ color: "#000" }}>{t("brands.select_group")}</option>
                {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
              </select>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#E4E7F0" }}>{b.group_name || t("brands.select_group")}</span>
            )}
            <button onClick={() => remove(b)} className="text-xs" style={{ color: "#DC2626" }}>✕</button>
          </div>
        ))}
        {brands.length === 0 && <div className="text-xs" style={{ color: "#6B7280" }}>—</div>}
      </div>

      {open ? (
        <div className="flex flex-wrap gap-2 items-center">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("brands.new_name")}
            className="bg-transparent border rounded px-3 py-2 text-sm flex-1" style={{ borderColor: "#D3D8E4", minWidth: "160px" }} />
          {user.role === "master" && (
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent border rounded px-3 py-2 text-sm" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>{t("brands.select_group")}</option>
              {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
            </select>
          )}
          <button onClick={add} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{busy ? "…" : "✓"}</button>
          <button onClick={() => setOpen(false)} className="px-3 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>✕</button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-sm px-3 py-1.5 rounded" style={{ background: "#E4E7F0" }}>+ {t("brands.new_name")}</button>
      )}
      {error && <div className="text-xs mt-2" style={{ color: "#DC2626" }}>{error}</div>}
    </div>
  );
}

export default function PortfolioList({ user }) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [brands, setBrands] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setItems(await api.listPortfolio());
    setGroups(await api.listGroups());
    setBrands(await api.listBrands());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (selectedId) return <PortfolioDetail productId={selectedId} user={user} brands={brands} onBack={() => { setSelectedId(null); load(); }} />;

  const canAdd = user.role === "master" || user.role === "bm";
  const byGroup = {};
  for (const it of items) {
    const key = it.group_name || "Без команды";
    (byGroup[key] ||= []).push(it);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="font-display text-2xl font-semibold">Портфолио</div>
        <button onClick={() => authedDownload(api.portfolioAllBrochureUrl())} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>Скачать всю брошюру (PDF)</button>
      </div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>Карточки препаратов: материалы, ключевые сообщения, конкуренты</div>

      {canAdd && <BrandManager user={user} groups={groups} brands={brands} onChanged={load} />}
      {canAdd && <AddProductForm user={user} groups={groups} onCreated={load} />}

      {loading ? <div style={{ color: "#6B7280" }}>Загрузка…</div> : (
        Object.entries(byGroup).map(([groupName, groupItems]) => {
          const byBrand = {};
          for (const it of groupItems) {
            const key = it.brand_name || t("brands.no_brand");
            (byBrand[key] ||= []).push(it);
          }
          return (
            <div key={groupName} className="mb-8">
              <div className="text-sm uppercase tracking-wide mb-3" style={{ color: "#ED3237" }}>{groupName}</div>
              {Object.entries(byBrand).map(([brandName, brandItems]) => (
                <div key={brandName} className="mb-4">
                  <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "#6B7280" }}>{brandName}</div>
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {brandItems.map((it) => (
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
              ))}
            </div>
          );
        })
      )}
      {!loading && items.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Пока нет ни одного препарата в вашей команде</div>}
    </div>
  );
}
