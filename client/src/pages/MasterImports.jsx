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

function ActiveImportRow({ entry, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function del() {
    if (!confirm("Полностью удалить этот файл загрузки? После удаления плитка станет пустой, и можно будет загрузить новый файл. Ранее занесённые данные (продажи/таргеты) останутся как есть, пока вы не загрузите новый файл поверх них.")) return;
    setBusy(true); setError("");
    try { await api.deleteImport(entry.id); onDeleted(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg p-3 text-sm" style={{ background: "#FFFFFF", border: "1px solid #E4E7F0" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div style={{ color: "#6B7280" }}>{entry.uploaded_by_name} · {new Date(entry.created_at).toLocaleString("ru-RU")}</div>
          <div style={{ color: "#6B7280" }}>Обновлено МП: {entry.summary?.mp_updated ?? "—"}</div>
        </div>
        <button onClick={del} disabled={busy} className="px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#DC262622", color: "#DC2626" }}>
          {busy ? "…" : "Удалить файл"}
        </button>
      </div>
      {error && <div className="text-xs mt-2" style={{ color: "#DC2626" }}>{error}</div>}
    </div>
  );
}

function TargetsTile({ activeList, onDeleted }) {
  const [open, setOpen] = useState(false);
  const hasActive = activeList.length > 0;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-semibold">Таргет</span>
          {hasActive && <span style={{ color: "#16A34A" }}>✓</span>}
        </div>
        <span style={{ color: "#6B7280" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          {hasActive ? (
            <div className="space-y-2">
              {activeList.map((entry) => (
                <div key={entry.id}>
                  <div className="text-xs uppercase mb-1" style={{ color: "#6B7280" }}>FY{entry.period_year - 1999}</div>
                  <ActiveImportRow entry={entry} onDeleted={onDeleted} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm" style={{ color: "#6B7280" }}>Файл ещё не загружен</div>
          )}
        </div>
      )}
    </div>
  );
}

function MonthTile({ monthIndex, entry, onDeleted }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full text-left p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{MONTHS[monthIndex]}</span>
          {entry && <span style={{ color: "#16A34A" }}>✓</span>}
        </div>
        <span className="text-xs" style={{ color: "#6B7280" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {entry ? <ActiveImportRow entry={entry} onDeleted={onDeleted} /> : <div className="text-xs" style={{ color: "#6B7280" }}>Файл ещё не загружен</div>}
        </div>
      )}
    </div>
  );
}

function ImportStatusTiles({ refreshKey, year }) {
  const [status, setStatus] = useState(null);

  async function load() { setStatus(await api.importStatus(year)); }
  useEffect(() => { load(); }, [refreshKey, year]);

  if (!status) return null;
  return (
    <div className="space-y-4">
      <TargetsTile activeList={status.targets} onDeleted={load} />
      <div>
        <div className="text-sm font-semibold mb-2" style={{ color: "#374151" }}>FSS продажи по месяцам, {year}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {MONTHS.map((_, i) => (
            <MonthTile key={i} monthIndex={i} entry={status.fss_by_month[i + 1] || null} onDeleted={load} />
          ))}
        </div>
      </div>
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
  const [statusYear, setStatusYear] = useState(now.getFullYear());

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
      setStatusYear(fssYear);
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

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="font-display text-lg">Статус загрузок</div>
          <label className="flex items-center gap-2 text-sm">
            <span style={{ color: "#6B7280" }}>Год</span>
            <input type="number" value={statusYear} onChange={(e) => setStatusYear(Number(e.target.value))} className="bg-transparent border rounded px-2 py-1 w-24" style={{ borderColor: "#D3D8E4" }} />
          </label>
        </div>
        <ImportStatusTiles refreshKey={refreshKey} year={statusYear} />
      </div>
    </div>
  );
}
