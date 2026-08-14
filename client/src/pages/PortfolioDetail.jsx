import React, { useEffect, useState } from "react";
import { api, authedDownload } from "../api.js";

const FILE_TYPE_LABEL = { pil: "PIL (инструкция)", slides: "Слайды визуальной поддержки", other: "Другое" };

export default function PortfolioDetail({ productId, user, onBack }) {
  const [data, setData] = useState(null);
  const [name, setName] = useState("");
  const [nrvUsd, setNrvUsd] = useState("");
  const [keyMessages, setKeyMessages] = useState("");
  const [positioning, setPositioning] = useState("");
  const [patientPortraits, setPatientPortraits] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadType, setUploadType] = useState("pil");
  const [compName, setCompName] = useState("");
  const [compDirect, setCompDirect] = useState(true);
  const [compPrice, setCompPrice] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadDone, setUploadDone] = useState(false);

  async function load() {
    const d = await api.getPortfolioItem(productId);
    setData(d);
    setName(d.product.name || "");
    setNrvUsd(String(d.product.nrv_usd ?? ""));
    setKeyMessages(d.product.key_messages || "");
    setPositioning(d.product.positioning || "");
    setPatientPortraits(d.product.patient_portraits || "");
  }
  useEffect(() => { load(); }, [productId]);

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
      await api.updatePortfolioItem(productId, { name, nrv_usd: Number(nrvUsd) || 0, key_messages: keyMessages, positioning, patient_portraits: patientPortraits });
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

  async function uploadFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); setError(""); setUploadProgress(0); setUploadDone(false);
    try {
      await api.uploadPortfolioFile(productId, uploadType, file, (pct) => setUploadProgress(pct));
      setUploadDone(true);
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); e.target.value = ""; setTimeout(() => { setUploadProgress(0); setUploadDone(false); }, 2500); }
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
              <div className="flex items-center gap-2 text-sm" style={{ color: "#6B7280" }}>
                {data.product.group_name || "—"} ·
                <span>$</span>
                <input type="number" value={nrvUsd} onChange={(e) => setNrvUsd(e.target.value)} className="bg-transparent border-b outline-none w-20 font-mono" style={{ borderColor: "#D3D8E4" }} />
              </div>
            </>
          ) : (
            <>
              <div className="font-display text-2xl font-semibold">{data.product.name}</div>
              <div className="text-sm" style={{ color: "#6B7280" }}>{data.product.group_name || "—"} · ${Number(data.product.nrv_usd).toFixed(2)}</div>
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
        <div className="font-display text-lg mb-3">Материалы</div>
        <div className="space-y-2 mb-4">
          {data.files.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#EEF1F8" }}>
              <div>
                <span style={{ color: "#6B7280" }}>{FILE_TYPE_LABEL[f.file_type]}:</span> {f.file_name}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => authedDownload(api.portfolioFileUrl(f.id))} className="text-xs" style={{ color: "#16A34A" }}>Скачать</button>
                {canEdit && <button onClick={() => removeFile(f.id)} className="text-xs" style={{ color: "#DC2626" }}>Удалить</button>}
              </div>
            </div>
          ))}
          {data.files.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Файлов пока нет</div>}
        </div>
        {canEdit && (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} className="bg-transparent border rounded px-2 py-2 text-sm" style={{ borderColor: "#D3D8E4" }}>
                <option value="pil" style={{ color: "#000" }}>PIL</option>
                <option value="slides" style={{ color: "#000" }}>Слайды</option>
                <option value="other" style={{ color: "#000" }}>Другое</option>
              </select>
              <label className="px-4 py-2 rounded text-sm cursor-pointer" style={{ background: "#16A34A", color: "#FFFFFF" }}>
                Загрузить файл
                <input type="file" onChange={uploadFile} className="hidden" disabled={busy} />
              </label>
            </div>
            {busy && uploadProgress > 0 && (
              <div className="mt-3">
                <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "#E4E7F0" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${uploadProgress}%`, background: "#ED3237" }} />
                </div>
                <div className="text-xs mt-1" style={{ color: "#6B7280" }}>{uploadProgress}%</div>
              </div>
            )}
            {uploadDone && <div className="text-sm mt-2" style={{ color: "#16A34A" }}>✓ Загружено успешно</div>}
          </div>
        )}
      </div>

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
