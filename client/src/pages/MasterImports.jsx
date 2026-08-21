import React, { useState, useEffect } from "react";
import { api } from "../api.js";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

function ResultBox({ result }) {
  if (!result) return null;
  return (
    <div className="mt-4 rounded-xl p-4 text-sm" style={{ background: "#EEF1F8" }}>
      <div className="font-semibold mb-2" style={{ color: "#16A34A" }}>✓ Обновлено медпредов: {result.mp_updated}</div>
      {result.no_mp_for_territory?.length > 0 && (
        <div className="mb-2">
          <div style={{ color: "#ED3237" }}>Нет активного МП для территорий:</div>
          <div style={{ color: "#6B7280" }}>{result.no_mp_for_territory.join(", ")}</div>
        </div>
      )}
      {(result.missing_areas?.length > 0 || result.missing_sheets?.length > 0) && (
        <div className="mb-2">
          <div style={{ color: "#DC2626" }}>Не найдены листы в файле:</div>
          <div style={{ color: "#6B7280" }}>{[...(result.missing_areas || []), ...(result.missing_sheets || [])].join(", ")}</div>
        </div>
      )}
      {result.unmatched_products?.length > 0 && (
        <div>
          <div style={{ color: "#ED3237" }}>Не распознаны как препараты из каталога ({result.unmatched_products.length}):</div>
          <div style={{ color: "#6B7280" }} className="max-h-32 overflow-y-auto">
            {result.unmatched_products.map((u, i) => <div key={i}>{u.sheet} · строка {u.row}: {u.name}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

function ImportHistory({ refreshKey }) {
  const [history, setHistory] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function load() { setHistory(await api.importHistory()); }
  useEffect(() => { load(); }, [refreshKey]);

  async function undo(id) {
    if (!confirm("Отменить эту загрузку? Значения вернутся к тем, что были до неё.")) return;
    setBusyId(id);
    try { await api.undoImport(id); await load(); }
    catch (e) { alert(e.message); }
    finally { setBusyId(null); }
  }

  if (!history) return null;
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">История загрузок</div>
      {history.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Загрузок пока не было</div>}
      <div className="space-y-2">
        {history.map((h) => (
          <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-sm" style={{ background: "#EEF1F8", opacity: (h.reverted || h.superseded_by) ? 0.6 : 1 }}>
            <div>
              <b>{h.import_type === "fss" ? "FSS продажи" : "Таргеты"}</b>
              {" "}· {h.import_type === "fss" ? `${h.period_month}/${h.period_year}` : `FY${h.period_year - 1999}`}
              {" "}· {h.uploaded_by_name} · {new Date(h.created_at).toLocaleString("ru-RU")}
              {h.reverted && <span style={{ color: "#DC2626" }}> · отменено</span>}
              {!h.reverted && h.superseded_by && <span style={{ color: "#6B7280" }}> · заменено новой загрузкой</span>}
              <div style={{ color: "#6B7280" }}>Обновлено МП: {h.summary?.mp_updated ?? "—"}</div>
            </div>
            {!h.reverted && !h.superseded_by && (
              <button onClick={() => undo(h.id)} disabled={busyId === h.id} className="px-3 py-1.5 rounded text-xs" style={{ background: "#DC262622", color: "#DC2626" }}>
                Отменить загрузку
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressBar({ progress, phase }) {
  if (!phase) return null;
  return (
    <div className="mt-3">
      {phase === "uploading" && (
        <>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "#E4E7F0" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: "#ED3237" }} />
          </div>
          <div className="text-xs mt-1" style={{ color: "#6B7280" }}>Отправка файла: {progress}%</div>
        </>
      )}
      {phase === "processing" && (
        <div className="flex items-center gap-2 text-sm" style={{ color: "#6B7280" }}>
          <span className="inline-block w-3 h-3 rounded-full animate-pulse" style={{ background: "#ED3237" }} />
          Файл отправлен, обрабатываю данные на сервере (может занять до минуты)…
        </div>
      )}
      {phase === "done" && <div className="text-sm" style={{ color: "#16A34A" }}>✓ Загружено успешно</div>}
    </div>
  );
}

export default function MasterImports() {
  const now = new Date();
  const [fssYear, setFssYear] = useState(now.getFullYear());
  const [fssMonth, setFssMonth] = useState(now.getMonth() + 1);
  const [fssFile, setFssFile] = useState(null);
  const [fssBusy, setFssBusy] = useState(false);
  const [fssResult, setFssResult] = useState(null);
  const [fssError, setFssError] = useState("");
  const [fssProgress, setFssProgress] = useState(0);
  const [fssPhase, setFssPhase] = useState(null);

  const [fy, setFy] = useState(27);
  const [tgtFile, setTgtFile] = useState(null);
  const [tgtBusy, setTgtBusy] = useState(false);
  const [tgtResult, setTgtResult] = useState(null);
  const [tgtError, setTgtError] = useState("");
  const [tgtProgress, setTgtProgress] = useState(0);
  const [tgtPhase, setTgtPhase] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function uploadFss() {
    if (!fssFile) { setFssError("Выберите файл"); return; }
    setFssBusy(true); setFssError(""); setFssResult(null); setFssProgress(0); setFssPhase("uploading");
    try {
      const result = await api.importFss(fssFile, fssYear, fssMonth, (pct) => {
        setFssProgress(pct);
        if (pct >= 100) setFssPhase("processing");
      });
      setFssPhase("done");
      setFssResult(result);
      setRefreshKey((k) => k + 1);
    } catch (e) { setFssError(e.message); setFssPhase(null); } finally { setFssBusy(false); }
  }
  async function uploadTargets() {
    if (!tgtFile) { setTgtError("Выберите файл"); return; }
    setTgtBusy(true); setTgtError(""); setTgtResult(null); setTgtProgress(0); setTgtPhase("uploading");
    try {
      const result = await api.importTargets(tgtFile, fy, (pct) => {
        setTgtProgress(pct);
        if (pct >= 100) setTgtPhase("processing");
      });
      setTgtPhase("done");
      setTgtResult(result);
      setRefreshKey((k) => k + 1);
    } catch (e) { setTgtError(e.message); setTgtPhase(null); } finally { setTgtBusy(false); }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-5 py-8 space-y-8">
      <div>
        <div className="font-display text-2xl font-semibold mb-1">Загрузка данных</div>
        <div className="text-sm" style={{ color: "#6B7280" }}>Продажи и таргеты распределяются автоматически по территориям медпредов</div>
      </div>

      <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">Загрузить отчёт FSS (продажи за месяц)</div>
        <div className="flex flex-wrap gap-3 items-end mb-3">
          <label className="flex flex-col gap-1 text-sm">
            <span style={{ color: "#6B7280" }}>Месяц</span>
            <select value={fssMonth} onChange={(e) => setFssMonth(Number(e.target.value))} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1} style={{ color: "#000" }}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span style={{ color: "#6B7280" }}>Год</span>
            <input type="number" value={fssYear} onChange={(e) => setFssYear(Number(e.target.value))} className="bg-transparent border rounded px-3 py-2 w-24" style={{ borderColor: "#D3D8E4" }} />
          </label>
        </div>
        <input type="file" accept=".xlsx" onChange={(e) => setFssFile(e.target.files[0])}
          className="text-sm mb-3 block" />
        {fssFile && (
          <button onClick={uploadFss} disabled={fssBusy} className="px-5 py-2.5 rounded font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>
            {fssBusy ? "Загрузка…" : "Загрузить"}
          </button>
        )}
        {fssError && <div className="text-sm mt-3" style={{ color: "#DC2626" }}>{fssError}</div>}
        <ProgressBar progress={fssProgress} phase={fssPhase} />
        <ResultBox result={fssResult} />
      </div>

      <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="font-display text-lg mb-3">Загрузить Таргеты (план продаж на год)</div>
        <label className="flex flex-col gap-1 text-sm mb-3 w-32">
          <span style={{ color: "#6B7280" }}>Финансовый год</span>
          <select value={fy} onChange={(e) => setFy(Number(e.target.value))} className="bg-transparent border rounded px-3 py-2" style={{ borderColor: "#D3D8E4" }}>
            {Array.from({ length: 163 }, (_, i) => 27 + i).map((n) => <option key={n} value={n} style={{ color: "#000" }}>FY{n}</option>)}
          </select>
        </label>
        <input type="file" accept=".xlsx" onChange={(e) => setTgtFile(e.target.files[0])}
          className="text-sm mb-3 block" />
        {tgtFile && (
          <button onClick={uploadTargets} disabled={tgtBusy} className="px-5 py-2.5 rounded font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>
            {tgtBusy ? "Загрузка…" : "Загрузить"}
          </button>
        )}
        {tgtError && <div className="text-sm mt-3" style={{ color: "#DC2626" }}>{tgtError}</div>}
        <ProgressBar progress={tgtProgress} phase={tgtPhase} />
        <ResultBox result={tgtResult} />
      </div>

      <ImportHistory refreshKey={refreshKey} />
    </div>
  );
}
