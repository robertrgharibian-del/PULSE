import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";
import PortfolioDetail from "./PortfolioDetail.jsx";

export default function BrandDetail({ brandId, user, groups, onBack }) {
  const { t } = useLanguage();
  const [brand, setBrand] = useState(null);
  const [allItems, setAllItems] = useState([]);
  const [allBrands, setAllBrands] = useState([]);
  const [selectedSkuId, setSelectedSkuId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [showAddSku, setShowAddSku] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canEdit = user.role === "master" || (user.role === "bm" && brand?.group_id === user.group_id);

  async function load() {
    const [brands, items] = await Promise.all([api.listBrands(), api.listPortfolio()]);
    setAllBrands(brands);
    setAllItems(items);
    const b = brands.find((x) => String(x.id) === String(brandId));
    setBrand(b);
    if (b) { setName(b.name); setGroupId(b.group_id || ""); }
  }
  useEffect(() => { load(); }, [brandId]);

  if (selectedSkuId) return <PortfolioDetail productId={selectedSkuId} user={user} brands={allBrands} onBack={() => { setSelectedSkuId(null); load(); }} />;
  if (!brand) return <div className="p-8" style={{ color: "#6B7280" }}>{t("common.loading")}</div>;

  const skusInBrand = allItems.filter((it) => String(it.brand_id) === String(brandId));
  const skusAvailableToAdd = allItems.filter((it) => String(it.brand_id) !== String(brandId) && it.group_id === brand.group_id);

  async function saveEdit() {
    setBusy(true); setError("");
    try {
      await api.updateBrand(brandId, { name, group_id: user.role === "master" ? (groupId || null) : undefined });
      setEditing(false);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function addSku(skuId) {
    setBusy(true); setError("");
    try { await api.updatePortfolioItem(skuId, { brand_id: brandId }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function removeSku(skuId) {
    setBusy(true); setError("");
    try { await api.updatePortfolioItem(skuId, { brand_id: null }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#6B7280" }}>← {t("common.back")}</button>

      <div className="rounded-2xl p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        {editing ? (
          <div className="space-y-3">
            <input value={name} onChange={(e) => setName(e.target.value)} className="font-display text-2xl font-semibold bg-transparent border-b outline-none w-full" style={{ borderColor: "#D3D8E4" }} />
            {user.role === "master" && (
              <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="bg-transparent border rounded px-3 py-2 text-sm" style={{ borderColor: "#D3D8E4" }}>
                <option value="" style={{ color: "#000" }}>{t("brands.select_group")}</option>
                {groups.map((g) => <option key={g.id} value={g.id} style={{ color: "#000" }}>{g.name}</option>)}
              </select>
            )}
            {error && <div className="text-sm" style={{ color: "#DC2626" }}>{error}</div>}
            <div className="flex gap-2">
              <button onClick={saveEdit} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.save")}</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>{t("common.cancel")}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-display text-2xl font-semibold">{brand.name}</div>
              <div className="text-sm" style={{ color: "#6B7280" }}>{brand.group_name || t("brands.select_group")} · {skusInBrand.length} {t("brands.sku_count")}</div>
            </div>
            {canEdit && <button onClick={() => setEditing(true)} className="text-sm px-3 py-1.5 rounded" style={{ background: "#E4E7F0" }}>{t("common.change")}</button>}
          </div>
        )}
      </div>

      <div className="font-display text-lg mb-3">SKU</div>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {skusInBrand.map((it) => (
          <div key={it.id} className="rounded-2xl p-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
            <button onClick={() => setSelectedSkuId(it.id)} className="text-left w-full">
              <div className="font-semibold">{it.name}</div>
              <div className="text-xs mt-1 font-mono" style={{ color: "#6B7280" }}>${Number(it.nrv_usd).toFixed(2)}</div>
            </button>
            {canEdit && <button onClick={() => removeSku(it.id)} disabled={busy} className="text-xs mt-2" style={{ color: "#DC2626" }}>{t("brands.remove_from_brand")}</button>}
          </div>
        ))}
        {skusInBrand.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("brands.empty_brand")}</div>}
      </div>

      {canEdit && (
        <div className="rounded-2xl p-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          {showAddSku ? (
            <div>
              <div className="text-sm font-semibold mb-2">{t("brands.add_existing_sku")}</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {skusAvailableToAdd.map((it) => (
                  <div key={it.id} className="flex items-center justify-between rounded-lg p-2 text-sm" style={{ background: "#EEF1F8" }}>
                    <span>{it.name} {it.brand_name ? <span style={{ color: "#6B7280" }}>({it.brand_name})</span> : null}</span>
                    <button onClick={() => addSku(it.id)} disabled={busy} className="text-xs px-2 py-1 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>+ {t("common.add")}</button>
                  </div>
                ))}
                {skusAvailableToAdd.length === 0 && <div className="text-xs" style={{ color: "#6B7280" }}>{t("brands.no_more_sku")}</div>}
              </div>
              <button onClick={() => setShowAddSku(false)} className="text-xs mt-3" style={{ color: "#6B7280" }}>{t("common.cancel")}</button>
            </div>
          ) : (
            <button onClick={() => setShowAddSku(true)} className="text-sm px-3 py-1.5 rounded" style={{ background: "#E4E7F0" }}>+ {t("brands.add_existing_sku")}</button>
          )}
        </div>
      )}
      {error && !editing && <div className="text-sm mt-3" style={{ color: "#DC2626" }}>{error}</div>}
    </div>
  );
}
