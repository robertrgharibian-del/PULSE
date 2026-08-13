import React, { useEffect, useState } from "react";
import { api, authedDownload } from "../api.js";

const FILE_TYPE_LABEL = { pil: "PIL (инструкция)", slides: "Слайды визуальной поддержки", other: "Другое" };

export default function PortfolioDetail({ productId, user, onBack }) {
  const [data, setData] = useState(null);
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

  async function load() {
    const d = await api.getPortfolioItem(productId);
    setData(d);
    setKeyMessages(d.product.key_messages || "");
    setPositioning(d.product.positioning || "");
    setPatientPortraits(d.product.patient_portraits || "");
  }
  useEffect(() => { load(); }, [productId]);

  if (!data) return <div className="p-8" style={{ color: "#8493AA" }}>Загрузка…</div>;

  async function saveContent() {
    setBusy(true); setError(""); setSaved(false);
    try {
      await api.updatePortfolioItem(productId, { key_messages: keyMessages, positioning, patient_portraits: patientPortraits });
      setSaved(true);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function uploadFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setBusy(true); setError("");
    try { await api.uploadPortfolioFile(productId, uploadType, file); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); e.target.value = ""; }
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
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#8493AA" }}>← Назад к портфолио</button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <div className="font-display text-2xl font-semibold">{data.product.name}</div>
          <div className="text-sm" style={{ color: "#8493AA" }}>{data.product.group_name || "—"} · ${Number(data.product.nrv_usd).toFixed(2)}</div>
        </div>
        <button onClick={() => authedDownload(api.portfolioBrochureUrl(productId))} className="px-4 py-2 rounded text-sm" style={{ background: "#22304A" }}>Скачать брошюру (PDF)</button>
      </div>

      {error && <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#E2574C22", color: "#E2574C" }}>{error}</div>}

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
        <div className="font-display text-lg mb-3">Содержание карточки</div>
        {[["Ключевые сообщения", keyMessages, setKeyMessages], ["Позиционирование", positioning, setPositioning], ["Портреты пациентов", patientPortraits, setPatientPortraits]].map(([label, val, setter]) => (
          <div key={label} className="mb-3">
            <div className="text-xs uppercase mb-1" style={{ color: "#8493AA" }}>{label}</div>
            {canEdit ? (
              <textarea rows={3} value={val} onChange={(e) => setter(e.target.value)} className="w-full bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
            ) : <div className="text-sm">{val || "—"}</div>}
          </div>
        ))}
        {canEdit && (
          <button onClick={saveContent} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>
            {saved ? "✓ Сохранено" : "Сохранить"}
          </button>
        )}
      </div>

      <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
        <div className="font-display text-lg mb-3">Материалы</div>
        <div className="space-y-2 mb-4">
          {data.files.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#1B2A44" }}>
              <div>
                <span style={{ color: "#8493AA" }}>{FILE_TYPE_LABEL[f.file_type]}:</span> {f.file_name}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => authedDownload(api.portfolioFileUrl(f.id))} className="text-xs" style={{ color: "#3FB88F" }}>Скачать</button>
                {canEdit && <button onClick={() => removeFile(f.id)} className="text-xs" style={{ color: "#E2574C" }}>Удалить</button>}
              </div>
            </div>
          ))}
          {data.files.length === 0 && <div className="text-sm" style={{ color: "#8493AA" }}>Файлов пока нет</div>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <select value={uploadType} onChange={(e) => setUploadType(e.target.value)} className="bg-transparent border rounded px-2 py-2 text-sm" style={{ borderColor: "#3A4A66" }}>
              <option value="pil" style={{ color: "#000" }}>PIL</option>
              <option value="slides" style={{ color: "#000" }}>Слайды</option>
              <option value="other" style={{ color: "#000" }}>Другое</option>
            </select>
            <label className="px-4 py-2 rounded text-sm cursor-pointer" style={{ background: "#3FB88F", color: "#0E1726" }}>
              Загрузить файл
              <input type="file" onChange={uploadFile} className="hidden" />
            </label>
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#141F33", border: "1px solid #22304A" }}>
        <div className="font-display text-lg mb-3">Конкуренты</div>
        <div className="space-y-2 mb-4">
          {data.competitors.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#1B2A44" }}>
              <div>{c.competitor_name} <span style={{ color: "#8493AA" }}>({c.is_direct ? "прямой" : "непрямой"})</span></div>
              <div className="flex items-center gap-3">
                <span className="font-mono">{c.competitor_price_usd != null ? `$${Number(c.competitor_price_usd).toFixed(2)}` : "—"}</span>
                {canEdit && <button onClick={() => removeCompetitor(c.id)} className="text-xs" style={{ color: "#E2574C" }}>Удалить</button>}
              </div>
            </div>
          ))}
          {data.competitors.length === 0 && <div className="text-sm" style={{ color: "#8493AA" }}>Конкуренты не добавлены</div>}
        </div>
        {data.avg_competitor_price_usd != null && (
          <div className="text-sm mb-4 font-mono" style={{ color: "#E8B04B" }}>
            Средняя цена конкурентов: ${data.avg_competitor_price_usd.toFixed(2)} · наша цена: ${Number(data.product.nrv_usd).toFixed(2)}
          </div>
        )}
        {canEdit && (
          <div className="grid sm:grid-cols-4 gap-2 text-sm">
            <input placeholder="Название конкурента" value={compName} onChange={(e) => setCompName(e.target.value)} className="bg-transparent border rounded px-2 py-2 sm:col-span-2" style={{ borderColor: "#3A4A66" }} />
            <select value={compDirect ? "1" : "0"} onChange={(e) => setCompDirect(e.target.value === "1")} className="bg-transparent border rounded px-2 py-2" style={{ borderColor: "#3A4A66" }}>
              <option value="1" style={{ color: "#000" }}>Прямой</option>
              <option value="0" style={{ color: "#000" }}>Непрямой</option>
            </select>
            <div className="flex gap-2">
              <input placeholder="Цена, $" type="number" value={compPrice} onChange={(e) => setCompPrice(e.target.value)} className="flex-1 bg-transparent border rounded px-2 py-2 font-mono" style={{ borderColor: "#3A4A66" }} />
              <button onClick={addCompetitor} disabled={busy} className="px-3 py-2 rounded text-xs" style={{ background: "#3FB88F", color: "#0E1726" }}>+</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
