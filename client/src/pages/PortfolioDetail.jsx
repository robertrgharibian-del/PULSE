import React, { useEffect, useState } from "react";
import { api, authedDownload } from "../api.js";
import Lightbox from "../components/Lightbox.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function ProgressBar({ progress, done }) {
  if (!progress && !done) return null;
  return (
    <div className="mt-3">
      {!done && (
        <>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "#E4E7F0" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: "#ED3237" }} />
          </div>
          <div className="text-xs mt-1" style={{ color: "#6B7280" }}>{progress}%</div>
        </>
      )}
      {done && <div className="text-sm" style={{ color: "#16A34A" }}>✓ Загружено успешно</div>}
    </div>
  );
}

/* ---- Visual Aid slides ---- */
function VisualAidsSection({ productId, items, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [contentDesc, setContentDesc] = useState("");
  const [purpose, setPurpose] = useState("");
  const [detailScript, setDetailScript] = useState("");
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!file) { setError("Выберите изображение слайда"); return; }
    setBusy(true); setError(""); setProgress(0); setDone(false);
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("content_desc", contentDesc);
      fd.append("purpose", purpose);
      fd.append("detail_script", detailScript);
      fd.append("comments", comments);
      await api.addVisualAid(productId, fd, (pct) => setProgress(pct));
      setDone(true);
      setFile(null); setContentDesc(""); setPurpose(""); setDetailScript(""); setComments("");
      setOpen(false);
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Удалить слайд?")) return;
    try { await api.deleteVisualAid(id); onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-1">Visual Aid — слайды для визитов</div>
      <div className="text-xs mb-3" style={{ color: "#6B7280" }}>Слайд крупно + описание, для чего он и как его подавать на визите</div>

      <div className="space-y-4 mb-4">
        {items.map((va) => (
          <div key={va.id} className="rounded-xl p-3 flex flex-col sm:flex-row gap-4" style={{ background: "#EEF1F8" }}>
            <Lightbox src={api.visualAidImageUrl(va.id)} alt={va.image_name}>
              <img src={api.visualAidImageUrl(va.id)} alt={va.image_name} className="rounded-lg object-cover" style={{ width: "220px", maxWidth: "100%", height: "auto" }} />
            </Lightbox>
            <div className="flex-1 text-sm space-y-2">
              {[["Содержание слайда", va.content_desc], ["Цель слайда", va.purpose], ["Детализация", va.detail_script], ["Комментарии", va.comments]].map(([label, val]) => val && (
                <div key={label}>
                  <div className="text-xs uppercase" style={{ color: "#8B96AA" }}>{label}</div>
                  <div>{val}</div>
                </div>
              ))}
              {canEdit && <button onClick={() => remove(va.id)} className="text-xs" style={{ color: "#DC2626" }}>Удалить слайд</button>}
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Слайдов пока нет</div>}
      </div>

      {canEdit && (
        open ? (
          <div className="rounded-xl p-3" style={{ background: "#EEF1F8" }}>
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} className="text-sm mb-3 block" />
            <div className="grid sm:grid-cols-2 gap-2 mb-3">
              <textarea rows={2} placeholder="Содержание слайда" value={contentDesc} onChange={(e) => setContentDesc(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <textarea rows={2} placeholder="Цель слайда" value={purpose} onChange={(e) => setPurpose(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <textarea rows={2} placeholder="Детализация (спич МП)" value={detailScript} onChange={(e) => setDetailScript(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <textarea rows={2} placeholder="Комментарии" value={comments} onChange={(e) => setComments(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
            </div>
            {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить слайд</button>
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>Отмена</button>
            </div>
            <ProgressBar progress={progress} done={done} />
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ Добавить слайд</button>
        )
      )}
    </div>
  );
}

/* ---- Promo materials ---- */
function PromoMaterialsSection({ productId, items, canEdit, options, onChanged }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [materialName, setMaterialName] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [audience, setAudience] = useState([]);
  const [contentDesc, setContentDesc] = useState("");
  const [purpose, setPurpose] = useState("");
  const [detailScript, setDetailScript] = useState("");
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  function toggleAudience(a) {
    setAudience((arr) => arr.includes(a) ? arr.filter((x) => x !== a) : [...arr, a]);
  }

  async function submit() {
    if (!file) { setError("Выберите файл материала"); return; }
    if (!materialName.trim()) { setError("Укажите название материала"); return; }
    setBusy(true); setError(""); setProgress(0); setDone(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("material_name", materialName.trim());
      fd.append("material_type", materialType);
      fd.append("target_audience", JSON.stringify(audience));
      fd.append("content_desc", contentDesc);
      fd.append("purpose", purpose);
      fd.append("detail_script", detailScript);
      fd.append("comments", comments);
      await api.addPromoMaterial(productId, fd, (pct) => setProgress(pct));
      setDone(true);
      setFile(null); setMaterialName(""); setMaterialType(""); setAudience([]); setContentDesc(""); setPurpose(""); setDetailScript(""); setComments("");
      setOpen(false);
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Удалить материал?")) return;
    try { await api.deletePromoMaterial(id); onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-1">Промо материалы</div>
      <div className="text-xs mb-3" style={{ color: "#6B7280" }}>Лифлеты, буклеты, постеры и другие материалы для аудитории</div>

      <div className="space-y-4 mb-4">
        {items.map((pm) => {
          const isPdf = pm.file_mime === "application/pdf";
          const fileUrl = api.promoMaterialFileUrl(pm.id);
          return (
            <div key={pm.id} className="rounded-xl p-3 flex flex-col sm:flex-row gap-4" style={{ background: "#EEF1F8" }}>
              {isPdf ? (
                <div style={{ width: "260px", maxWidth: "100%" }}>
                  <iframe src={fileUrl} title={pm.file_name} className="rounded-lg" style={{ width: "100%", height: "320px", border: "1px solid #D3D8E4" }} />
                  <a href={fileUrl} target="_blank" rel="noreferrer" className="text-xs block mt-1" style={{ color: "#16A34A" }}>Открыть PDF полностью</a>
                </div>
              ) : (
                <Lightbox src={fileUrl} alt={pm.file_name}>
                  <img src={fileUrl} alt={pm.file_name} className="rounded-lg object-cover" style={{ width: "220px", maxWidth: "100%", height: "auto" }} />
                </Lightbox>
              )}
              <div className="flex-1 text-sm space-y-2">
                <div className="font-semibold">{pm.material_name}</div>
                {[["Тип материала", pm.material_type], ["Целевая аудитория", (pm.target_audience || []).join(", ")], ["Содержание материала", pm.content_desc], ["Цель материала", pm.purpose], ["Детализация", pm.detail_script], ["Комментарии", pm.comments]].map(([label, val]) => val && (
                  <div key={label}>
                    <div className="text-xs uppercase" style={{ color: "#8B96AA" }}>{label}</div>
                    <div>{val}</div>
                  </div>
                ))}
                {canEdit && <button onClick={() => remove(pm.id)} className="text-xs" style={{ color: "#DC2626" }}>Удалить материал</button>}
              </div>
            </div>
          );
        })}
        {items.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Материалов пока нет</div>}
      </div>

      {canEdit && (
        open ? (
          <div className="rounded-xl p-3" style={{ background: "#EEF1F8" }}>
            <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0])} className="text-sm mb-3 block" />
            <div className="grid sm:grid-cols-2 gap-2 mb-3">
              <input placeholder="Название материала" value={materialName} onChange={(e) => setMaterialName(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <select value={materialType} onChange={(e) => setMaterialType(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }}>
                <option value="" style={{ color: "#000" }}>Тип материала</option>
                {(options.material_types || []).map((t) => <option key={t} value={t} style={{ color: "#000" }}>{t}</option>)}
              </select>
            </div>
            <div className="mb-3">
              <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>Целевая аудитория (можно несколько)</div>
              <div className="flex flex-wrap gap-2">
                {(options.audience_options || []).map((a) => (
                  <button key={a} type="button" onClick={() => toggleAudience(a)} className="px-2.5 py-1 rounded-full text-xs"
                    style={{ background: audience.includes(a) ? "#ED3237" : "#FFFFFF", color: audience.includes(a) ? "#FFFFFF" : "#1F2937", border: "1px solid #D3D8E4" }}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 mb-3">
              <textarea rows={2} placeholder="Содержание материала" value={contentDesc} onChange={(e) => setContentDesc(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <textarea rows={2} placeholder="Цель материала" value={purpose} onChange={(e) => setPurpose(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <textarea rows={2} placeholder="Детализация (как использовать на визите)" value={detailScript} onChange={(e) => setDetailScript(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <textarea rows={2} placeholder="Комментарии" value={comments} onChange={(e) => setComments(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
            </div>
            {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить материал</button>
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>Отмена</button>
            </div>
            <ProgressBar progress={progress} done={done} />
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ Добавить материал</button>
        )
      )}
    </div>
  );
}

/* ---- Scientific info ---- */
function ScientificInfoSection({ productId, items, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!file || !title.trim()) { setError("Укажите название и выберите файл"); return; }
    setBusy(true); setError(""); setProgress(0); setDone(false);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title.trim());
      fd.append("comments", comments);
      await api.addScientificInfo(productId, fd, (pct) => setProgress(pct));
      setDone(true);
      setFile(null); setTitle(""); setComments("");
      setOpen(false);
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm("Удалить материал?")) return;
    try { await api.deleteScientificInfo(id); onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-1">Научная информация</div>
      <div className="text-xs mb-3" style={{ color: "#6B7280" }}>Статьи, исследования, презентации, фото, видео — любой формат</div>

      <div className="space-y-2 mb-4">
        {items.map((si) => (
          <div key={si.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#EEF1F8" }}>
            <div>
              <div className="font-semibold">{si.title}</div>
              {si.comments && <div className="text-xs" style={{ color: "#6B7280" }}>{si.comments}</div>}
            </div>
            <div className="flex items-center gap-3">
              <a href={api.scientificInfoFileUrl(si.id)} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "#16A34A" }}>Скачать</a>
              {canEdit && <button onClick={() => remove(si.id)} className="text-xs" style={{ color: "#DC2626" }}>Удалить</button>}
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Материалов пока нет</div>}
      </div>

      {canEdit && (
        open ? (
          <div className="rounded-xl p-3" style={{ background: "#EEF1F8" }}>
            <input type="file" onChange={(e) => setFile(e.target.files[0])} className="text-sm mb-3 block" />
            <input placeholder="Название" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-transparent border rounded px-2 py-1.5 text-sm mb-2" style={{ borderColor: "#D3D8E4" }} />
            <textarea rows={2} placeholder="Комментарии" value={comments} onChange={(e) => setComments(e.target.value)} className="w-full bg-transparent border rounded px-2 py-1.5 text-sm mb-3" style={{ borderColor: "#D3D8E4" }} />
            {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить</button>
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>Отмена</button>
            </div>
            <ProgressBar progress={progress} done={done} />
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ Добавить материал</button>
        )
      )}
    </div>
  );
}

export default function PortfolioDetail({ productId, user, brands = [], onBack }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [options, setOptions] = useState({ material_types: [], audience_options: [] });
  const [name, setName] = useState("");
  const [nrvUsd, setNrvUsd] = useState("");
  const [brandId, setBrandId] = useState("");
  const [keyMessages, setKeyMessages] = useState("");
  const [positioning, setPositioning] = useState("");
  const [patientPortraits, setPatientPortraits] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [compName, setCompName] = useState("");
  const [compDirect, setCompDirect] = useState(true);
  const [compPrice, setCompPrice] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pilProgress, setPilProgress] = useState(0);
  const [pilDone, setPilDone] = useState(false);

  async function load() {
    try {
      const d = await api.getPortfolioItem(productId);
      setData(d);
      setName(d.product.name || "");
      setNrvUsd(String(d.product.nrv_usd ?? ""));
      setBrandId(d.product.brand_id || "");
      setKeyMessages(d.product.key_messages || "");
      setPositioning(d.product.positioning || "");
      setPatientPortraits(d.product.patient_portraits || "");
    } catch (e) {
      setLoadError(e.message);
    }
  }
  useEffect(() => { load(); api.portfolioOptions().then(setOptions); }, [productId]);

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8">
        <button onClick={onBack} className="text-sm mb-4" style={{ color: "#6B7280" }}>← Назад к портфолио</button>
        <div className="text-sm px-3 py-2 rounded" style={{ background: "#DC262622", color: "#DC2626" }}>{loadError}</div>
      </div>
    );
  }

  if (deleted) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8">
        <div className="text-sm mb-4" style={{ color: "#16A34A" }}>✓ Препарат удалён из портфолио</div>
        <button onClick={onBack} className="text-sm" style={{ color: "#6B7280" }}>← Назад к портфолио</button>
      </div>
    );
  }

  if (!data) return <div className="p-8" style={{ color: "#6B7280" }}>Загрузка…</div>;

  async function saveContent() {
    setBusy(true); setError(""); setSaved(false);
    try {
      await api.updatePortfolioItem(productId, { name, nrv_usd: Number(nrvUsd) || 0, key_messages: keyMessages, positioning, patient_portraits: patientPortraits, brand_id: brandId || null });
      setSaved(true);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function deleteProduct() {
    if (!confirm(`Удалить препарат «${data.product.name}» из портфолио? Он исчезнет из всех списков.`)) return;
    if (!confirm(`Это действие нужно подтвердить ещё раз. Точно удалить «${data.product.name}»?`)) return;
    setBusy(true); setError("");
    try {
      await api.deletePortfolioItem(productId);
      setDeleted(true);
    } catch (e) { setError(e.message); setBusy(false); }
  }

  async function uploadPil(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); setError(""); setPilProgress(0); setPilDone(false);
    try {
      await api.uploadPortfolioFile(productId, "pil", file, (pct) => setPilProgress(pct));
      setPilDone(true);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); e.target.value = ""; setTimeout(() => { setPilProgress(0); setPilDone(false); }, 2500); }
  }

  async function removeFile(id) {
    if (!confirm("Удалить файл?")) return;
    try { await api.deletePortfolioFile(id); await load(); } catch (e) { setError(e.message); }
  }

  async function addCompetitor() {
    if (!compName.trim()) return;
    setBusy(true); setError("");
    try {
      await api.addCompetitor(productId, { competitor_name: compName.trim(), is_direct: compDirect, competitor_price_usd: compPrice ? Number(compPrice) : null });
      setCompName(""); setCompPrice("");
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function removeCompetitor(cid) {
    if (!confirm("Удалить конкурента?")) return;
    try { await api.deleteCompetitor(cid); await load(); } catch (e) { setError(e.message); }
  }

  const canEdit = data.can_edit;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8">
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#6B7280" }}>← Назад к портфолио</button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="flex-1 min-w-[200px]">
          {canEdit ? (
            <>
              <input value={name} onChange={(e) => setName(e.target.value)} className="font-display text-2xl font-semibold bg-transparent border-b outline-none w-full mb-1" style={{ borderColor: "#D3D8E4" }} />
              <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "#6B7280" }}>
                <span>$</span>
                <input type="number" value={nrvUsd} onChange={(e) => setNrvUsd(e.target.value)} className="bg-transparent border-b outline-none w-20 font-mono" style={{ borderColor: "#D3D8E4" }} />
                <span>·</span>
                <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="bg-transparent border-b outline-none text-sm" style={{ borderColor: "#D3D8E4" }}>
                  <option value="" style={{ color: "#000" }}>Без бренда</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id} style={{ color: "#000" }}>{b.name}</option>
                  ))}
                </select>
                {data.product.group_name && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#E4E7F0" }}>{data.product.group_name}</span>}
              </div>
              <div className="text-xs mt-1" style={{ color: "#9CA3AF" }}>{t("brands.team_hint")}</div>
            </>
          ) : (
            <>
              <div className="font-display text-2xl font-semibold">{data.product.name}</div>
              <div className="text-sm" style={{ color: "#6B7280" }}>{data.product.group_name || "—"}{data.product.brand_name ? ` · ${data.product.brand_name}` : ""} · ${Number(data.product.nrv_usd).toFixed(2)}</div>
            </>
          )}
        </div>
        <button onClick={() => authedDownload(api.portfolioBrochureUrl(productId))} className="px-4 py-2 rounded text-sm shrink-0" style={{ background: "#E4E7F0" }}>Скачать брошюру (PDF)</button>
      </div>

      {error && <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#DC262622", color: "#DC2626" }}>{error}</div>}

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">Содержание карточки</div>
        {[["Ключевые сообщения", keyMessages, setKeyMessages], ["Позиционирование", positioning, setPositioning], ["Портреты пациентов", patientPortraits, setPatientPortraits]].map(([label, val, setter]) => (
          <div key={label} className="mb-3">
            <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>{label}</div>
            {canEdit ? (
              <textarea rows={3} value={val} onChange={(e) => setter(e.target.value)} className="w-full bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }} />
            ) : <div className="text-sm">{val || "—"}</div>}
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap gap-3">
            <button onClick={saveContent} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>
              {saved ? "✓ Сохранено" : "Сохранить"}
            </button>
            <button onClick={deleteProduct} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#DC262622", color: "#DC2626" }}>
              Удалить препарат
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">PIL (инструкция по применению)</div>
        <div className="space-y-2 mb-4">
          {data.files.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#EEF1F8" }}>
              <div>{f.file_name}</div>
              <div className="flex items-center gap-3">
                <button onClick={() => authedDownload(api.portfolioFileUrl(f.id))} className="text-xs" style={{ color: "#16A34A" }}>Скачать</button>
                {canEdit && <button onClick={() => removeFile(f.id)} className="text-xs" style={{ color: "#DC2626" }}>Удалить</button>}
              </div>
            </div>
          ))}
          {data.files.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>PIL пока не загружен</div>}
        </div>
        {canEdit && (
          <div>
            <label className="px-4 py-2 rounded text-sm cursor-pointer inline-block" style={{ background: "#16A34A", color: "#FFFFFF" }}>
              Загрузить PIL
              <input type="file" onChange={uploadPil} className="hidden" disabled={busy} />
            </label>
            <ProgressBar progress={pilProgress} done={pilDone} />
          </div>
        )}
      </div>

      <VisualAidsSection productId={productId} items={data.visual_aids} canEdit={canEdit} onChanged={load} />
      <PromoMaterialsSection productId={productId} items={data.promo_materials} canEdit={canEdit} options={options} onChanged={load} />
      <ScientificInfoSection productId={productId} items={data.scientific_info} canEdit={canEdit} onChanged={load} />

      <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">Конкуренты</div>
        <div className="space-y-2 mb-4">
          {data.competitors.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#EEF1F8" }}>
              <div>{c.competitor_name} <span style={{ color: "#6B7280" }}>({c.is_direct ? "прямой" : "непрямой"})</span></div>
              <div className="flex items-center gap-3">
                <span className="font-mono">{c.competitor_price_usd != null ? `$${Number(c.competitor_price_usd).toFixed(2)}` : "—"}</span>
                {canEdit && <button onClick={() => removeCompetitor(c.id)} className="text-xs" style={{ color: "#DC2626" }}>Удалить</button>}
              </div>
            </div>
          ))}
          {data.competitors.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Конкуренты не добавлены</div>}
        </div>
        {data.avg_competitor_price_usd != null && (
          <div className="text-sm mb-4 font-mono" style={{ color: "#ED3237" }}>
            Средняя цена конкурентов: ${data.avg_competitor_price_usd.toFixed(2)} · наша цена: ${Number(data.product.nrv_usd).toFixed(2)}
          </div>
        )}
        {canEdit && (
          <div className="grid sm:grid-cols-4 gap-2 text-sm">
            <input placeholder="Название конкурента" value={compName} onChange={(e) => setCompName(e.target.value)} className="bg-transparent border rounded px-2 py-2 sm:col-span-2" style={{ borderColor: "#D3D8E4" }} />
            <select value={compDirect ? "1" : "0"} onChange={(e) => setCompDirect(e.target.value === "1")} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#D3D8E4" }}>
              <option value="1" style={{ color: "#000" }}>Прямой</option>
              <option value="0" style={{ color: "#000" }}>Непрямой</option>
            </select>
            <div className="flex gap-2">
              <input placeholder="Цена, $" type="number" value={compPrice} onChange={(e) => setCompPrice(e.target.value)} className="flex-1 bg-transparent border rounded px-2 py-2 font-mono" style={{ borderColor: "#D3D8E4" }} />
              <button onClick={addCompetitor} disabled={busy} className="px-3 py-2 rounded text-xs" style={{ background: "#16A34A", color: "#FFFFFF" }}>+</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
