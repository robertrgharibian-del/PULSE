import React, { useEffect, useState } from "react";
import { api, authedDownload } from "../api.js";
import PortfolioDetail from "./PortfolioDetail.jsx";
import BrandDetail from "./BrandDetail.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function AddProductForm({ user, groups, onCreated }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nrv, setNrv] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { setError("Укажите название"); return; }
    setBusy(true); setError("");
    try {
      await api.createPortfolioItem({ name: name.trim(), nrv_usd: Number(nrv) || 0 });
      setName(""); setNrv(""); setOpen(false);
      onCreated();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="px-5 py-2.5 rounded font-semibold mb-4" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ Добавить SKU</button>;

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">Новый SKU</div>
      <div className="text-xs mb-3" style={{ color: "#6B7280" }}>{t("brands.team_hint")}</div>
      <div className="grid sm:grid-cols-2 gap-2 text-sm mb-3">
        <input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder="Цена NRV, $" type="number" value={nrv} onChange={(e) => setNrv(e.target.value)} className="bg-transparent border rounded px-3 py-2 font-mono" style={{ borderColor: "#D3D8E4" }} />
      </div>
      {error && <div className="text-sm mb-2" style={{ color: "#DC2626" }}>{error}</div>}
      <div className="flex gap-3">
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить</button>
        <button onClick={() => setOpen(false)} className="px-4 py-2 rounded" style={{ background: "#E4E7F0" }}>Отмена</button>
      </div>
    </div>
  );
}

function BrandManager({ user, groups, onChanged }) {
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

  if (open) {
    return (
      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">{t("brands.new_name")}</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("brands.new_name")}
            className="bg-transparent border rounded px-3 py-2 text-sm flex-1" style={{ borderColor: "#D3D8E4", minWidth: "160px" }} />
          {user.role === "master" && (
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent border rounded px-3 py-2 text-sm" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>{t("brands.select_group")}</option>
              {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
            </select>
          )}
          <button onClick={add} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.save")}</button>
          <button onClick={() => setOpen(false)} className="px-3 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>{t("common.cancel")}</button>
        </div>
        {error && <div className="text-xs mt-2" style={{ color: "#DC2626" }}>{error}</div>}
      </div>
    );
  }
  return <button onClick={() => setOpen(true)} className="text-sm px-3 py-1.5 rounded mb-6" style={{ background: "#E4E7F0" }}>+ {t("brands.title")}</button>;
}

export default function PortfolioList({ user }) {
  const { t } = useLanguage();
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [brands, setBrands] = useState([]);
  const [selectedSkuId, setSelectedSkuId] = useState(null);
  const [selectedBrandId, setSelectedBrandId] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setItems(await api.listPortfolio());
    setGroups(await api.listGroups());
    setBrands(await api.listBrands());
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  if (selectedBrandId) return <BrandDetail brandId={selectedBrandId} user={user} groups={groups} onBack={() => { setSelectedBrandId(null); load(); }} />;
  if (selectedSkuId) return <PortfolioDetail productId={selectedSkuId} user={user} brands={brands} onBack={() => { setSelectedSkuId(null); load(); }} />;

  const canAdd = user.role === "master" || user.role === "bm";

  // Team -> { brandMap: { brandId: { brand, skus } }, loose: [SKUs without a brand] }
  const byGroupName = {};
  for (const it of items) {
    const key = it.group_name || "Без команды";
    (byGroupName[key] ||= { brandMap: {}, loose: [] });
    if (it.brand_id) {
      const bKey = it.brand_id;
      (byGroupName[key].brandMap[bKey] ||= { brand: brands.find((b) => String(b.id) === String(bKey)) || { id: bKey, name: it.brand_name }, skus: [] }).skus.push(it);
    } else {
      byGroupName[key].loose.push(it);
    }
  }
  // Include brands with zero SKUs too, so they're still visible/manageable
  for (const b of brands) {
    const key = b.group_name || "Без команды";
    (byGroupName[key] ||= { brandMap: {}, loose: [] });
    if (!byGroupName[key].brandMap[b.id]) byGroupName[key].brandMap[b.id] = { brand: b, skus: [] };
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="font-display text-2xl font-semibold">Портфолио</div>
        <button onClick={() => authedDownload(api.portfolioAllBrochureUrl())} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>Скачать всю брошюру (PDF)</button>
      </div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>Карточки препаратов: материалы, ключевые сообщения, конкуренты</div>

      {canAdd && <BrandManager user={user} groups={groups} onChanged={load} />}
      {canAdd && <AddProductForm user={user} groups={groups} onCreated={load} />}

      {loading ? <div style={{ color: "#6B7280" }}>Загрузка…</div> : (
        Object.entries(byGroupName).map(([groupName, { brandMap, loose }]) => (
          <div key={groupName} className="mb-8">
            <div className="text-sm uppercase tracking-wide mb-3" style={{ color: "#ED3237" }}>{groupName}</div>

            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              {Object.values(brandMap).map(({ brand, skus }) => (
                <button key={brand.id} onClick={() => setSelectedBrandId(brand.id)} className="text-left rounded-2xl p-5"
                  style={{ background: "linear-gradient(135deg,#EEF1F8,#F7F8FC)", border: "1px solid #E4E7F0" }}>
                  <div className="font-display text-lg font-semibold mb-2">{brand.name}</div>
                  {skus.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {skus.slice(0, 6).map((s) => (
                        <span key={s.id} className="text-xs px-2 py-1 rounded-full" style={{ background: "#FFFFFF", border: "1px solid #E4E7F0" }}>{s.name}</span>
                      ))}
                      {skus.length > 6 && <span className="text-xs px-2 py-1" style={{ color: "#6B7280" }}>+{skus.length - 6}</span>}
                    </div>
                  ) : (
                    <div className="text-xs" style={{ color: "#6B7280" }}>{t("brands.empty_brand")}</div>
                  )}
                </button>
              ))}
            </div>

            {loose.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide mb-2" style={{ color: "#6B7280" }}>{t("brands.no_brand")}</div>
                <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {loose.map((it) => (
                    <button key={it.id} onClick={() => setSelectedSkuId(it.id)} className="text-left rounded-2xl p-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
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
            )}
          </div>
        ))
      )}
      {!loading && items.length === 0 && brands.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Пока нет ни одного препарата в вашей команде</div>}
    </div>
  );
}
