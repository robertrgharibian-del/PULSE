import React, { useEffect, useState, useCallback, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from "recharts";
import { api, authedDownload } from "../api.js";
import Gauge from "./Gauge.jsx";
import NumField, { toNum, toInputStr } from "./NumField.jsx";

const SPECIALTIES = ["Кардиолог", "ВОП", "Терапевт", "Интервенционист", "Эндокринолог", "ЛОР", "Педиатр", "Аллерголог", "Пульмонолог", "Провизор"];
const MONTH_NAMES = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
function monthName(m) { return MONTH_NAMES[(m - 1 + 12) % 12]; }

const STATUS_LABEL = {
  draft: { label: "Черновик", color: "#6B7280" },
  submitted: { label: "На рассмотрении у РМ", color: "#ED3237" },
  returned: { label: "Возвращён на доработку", color: "#DC2626" },
  approved: { label: "Одобрено", color: "#16A34A" },
};

function RowComments({ comments, section, itemRef, canComment, onAdd }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const mine = comments.filter((c) => c.section === section && String(c.item_ref) === String(itemRef));
  return (
    <div className="mt-1">
      {mine.map((c) => (
        <div key={c.id} className="text-xs rounded px-2 py-1 mb-1" style={{ background: "#EEF1F8", color: "#374151" }}>
          <b style={{ color: "#ED3237" }}>{c.author_name}:</b> {c.comment_text}
        </div>
      ))}
      {canComment && (
        open ? (
          <div className="flex gap-1 mt-1">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Комментарий…"
              className="flex-1 bg-transparent border rounded px-2 py-1 text-xs" style={{ borderColor: "#D3D8E4" }} />
            <button onClick={() => { if (text.trim()) { onAdd(text.trim()); setText(""); setOpen(false); } }}
              className="text-xs px-2 rounded shrink-0" style={{ background: "#16A34A", color: "#FFFFFF" }}>ОК</button>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="text-xs" style={{ color: "#6B7280" }}>+ комментарий</button>
        )
      )}
    </div>
  );
}

const inputStyle = (color) => ({ borderColor: "#D3D8E4", color: color || "#1F2937", background: "transparent" });

// Color tiers per feedback: >=90% green, 80-89.99% yellow, <80% red
function achColor(pct) {
  if (pct >= 0.9) return "#16A34A";
  if (pct >= 0.8) return "#ED3237";
  return "#DC2626";
}
function tierLabelClient(a) {
  if (a < 0.9) return "Нет бонуса (<90%)";
  if (a < 1.0) return "60% ставки (90-99.99%)";
  if (a <= 1.25) return "100% ставки (100-124.99%)";
  return "Потолок 125%";
}
function fmtDelta(n, prefix = "") {
  const sign = n > 0 ? "+" : "";
  return `${sign}${prefix}${Math.round(n).toLocaleString()}`;
}
// Read-only display: an unfilled field (0) shows as blank, not "0" — avoids phantom zeros
function dispNum(v) {
  const n = Number(v);
  return n ? n.toLocaleString() : "";
}
function isUnderperforming(item) {
  return item.target_usd > 0 && item.actual_usd / item.target_usd < 0.8;
}

export default function ReportView({ reportId, user, onBack }) {
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("fss");
  const [fssRows, setFssRows] = useState([]); // { product_id, target_qty: string, actual_qty: string }
  const [ffeRows, setFfeRows] = useState([]);
  const [fieldDays, setFieldDays] = useState(null);
  const [apRows, setApRows] = useState([]);
  const [convRows, setConvRows] = useState([]);
  const [potRows, setPotRows] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [returnText, setReturnText] = useState("");
  const [quarterBonus, setQuarterBonus] = useState(null);
  const [fssLocked, setFssLocked] = useState(true);
  const [newOppName, setNewOppName] = useState("");
  const [oppValues, setOppValues] = useState({}); // { [oppId]: { [productId]: qtyStr } }
  const [oppBusy, setOppBusy] = useState(false);
  const [oppError, setOppError] = useState("");
  const [ffeLocked, setFfeLocked] = useState(true);
  const [convLocked, setConvLocked] = useState(true);
  const [potLocked, setPotLocked] = useState(true);

  const load = useCallback(async () => {
    const d = await api.getReport(reportId);
    setDetail(d);
    setFssRows(d.fss.items.map((i) => ({ product_id: i.product_id, target_qty: toInputStr(i.target_qty), actual_qty: toInputStr(i.actual_qty) })));
    setFfeRows(d.ffe.items.map((i) => ({
      metric_key: i.metric_key,
      master_list_count: toInputStr(i.master_list_count), approved_count: toInputStr(i.approved_count), achieved_count: toInputStr(i.achieved_count),
    })));
    setFieldDays(d.field_days ? Object.fromEntries(Object.entries(d.field_days).map(([k, v]) => [k, typeof v === "number" ? toInputStr(v) : v])) : null);
    setApRows(d.action_plan.map((a) => ({ ...a })));
    setConvRows(d.conversion.items.map((c) => ({ ...c,
      current_rx_per_week: toInputStr(c.current_rx_per_week), competitor_rx_per_week: toInputStr(c.competitor_rx_per_week), target_rx_per_week: toInputStr(c.target_rx_per_week),
      actual_result_rx_per_week: toInputStr(c.actual_result_rx_per_week) })));
    setPotRows(d.potential.items.map((c) => ({ ...c,
      current_potential_per_week: toInputStr(c.current_potential_per_week), target_rx_per_week: toInputStr(c.target_rx_per_week),
      actual_result_rx_per_week: toInputStr(c.actual_result_rx_per_week) })));
    setFssLocked(d.fss.items.some((i) => Number(i.target_qty) > 0 || Number(i.actual_qty) > 0));
    setFfeLocked(d.ffe.items.some((i) => Number(i.master_list_count) > 0 || Number(i.achieved_count) > 0));
    setConvLocked(d.conversion.items.length > 0);
    setPotLocked(d.potential.items.length > 0);
    const initOppValues = {};
    (d.opportunities || []).forEach((o) => {
      initOppValues[o.id] = {};
      o.values.forEach((v) => { initOppValues[o.id][v.product_id] = toInputStr(v.qty_packages); });
    });
    setOppValues(initOppValues);
    const quarter = Math.floor((d.report.period_month - 1) / 3) + 1;
    api.mpBonus(d.report.mp_id, d.report.period_year, quarter).then(setQuarterBonus).catch(() => setQuarterBonus(null));
  }, [reportId]);

  useEffect(() => { load(); }, [load]);

  const fssItemsSafe = detail?.fss?.items || [];
  const ffeItemsSafe = detail?.ffe?.items || [];
  const editableSafe = detail ? user.role === "mp" && ["draft", "returned"].includes(detail.report.status) : false;
  const fssEditable = editableSafe && !fssLocked;
  const ffeEditable = editableSafe && !ffeLocked;

  const liveFssItems = useMemo(() => fssItemsSafe.map((item, idx) => {
    const nrv = Number(item.nrv_usd);
    const t = fssEditable ? toNum(fssRows[idx]?.target_qty) : Number(item.target_qty);
    const a = fssEditable ? toNum(fssRows[idx]?.actual_qty) : Number(item.actual_qty);
    return { ...item, target_qty: t, actual_qty: a, target_usd: t * nrv, actual_usd: a * nrv };
  }), [fssItemsSafe, fssRows, fssEditable]);
  const liveFssTotals = useMemo(() => {
    const target_usd = liveFssItems.reduce((s, i) => s + i.target_usd, 0);
    const actual_usd = liveFssItems.reduce((s, i) => s + i.actual_usd, 0);
    return { target_usd, actual_usd, achievement: target_usd === 0 ? 0 : actual_usd / target_usd };
  }, [liveFssItems]);
  const liveFfeItems = useMemo(() => ffeItemsSafe.map((item, idx) => {
    const master_list_count = ffeEditable ? toNum(ffeRows[idx]?.master_list_count) : Number(item.master_list_count);
    const approved_count = ffeEditable ? toNum(ffeRows[idx]?.approved_count) : Number(item.approved_count);
    const achieved_count = ffeEditable ? toNum(ffeRows[idx]?.achieved_count) : Number(item.achieved_count);
    const denom = approved_count > 0 ? approved_count : master_list_count;
    const percent = denom > 0 ? achieved_count / denom : 0;
    return { ...item, master_list_count, approved_count, achieved_count, percent };
  }), [ffeItemsSafe, ffeRows, ffeEditable]);

  if (!detail) return <div className="p-8">Загрузка…</div>;

  const { report, mp, fss, ffe, comments } = detail;
  const editable = editableSafe;
  const convEditable = editable && !convLocked;
  const potEditable = editable && !potLocked;
  const canReview = user.role === "rm" && report.status === "submitted";
  const canComment = ["rm", "master", "bm"].includes(user.role) && ["submitted", "approved"].includes(report.status);
  const canToggleGate = user.role === "rm" || user.role === "master";
  const st = STATUS_LABEL[report.status];

  async function saveFss() {
    setBusy(true); setError("");
    try {
      await api.saveFss(reportId, fssRows.map((r) => ({ product_id: r.product_id, target_qty: toNum(r.target_qty), actual_qty: toNum(r.actual_qty) })));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function saveFfe() {
    setBusy(true); setError("");
    try {
      const daysInMonth = new Date(report.period_year, report.period_month, 0).getDate();
      const computedFieldDays = fieldDays ? Math.max(0, daysInMonth - toNum(fieldDays.non_working_days) - toNum(fieldDays.public_holidays) - toNum(fieldDays.training_days) - toNum(fieldDays.leave_days)) : 0;
      await api.saveFfe(
        reportId,
        ffeRows.map((r) => ({ metric_key: r.metric_key, master_list_count: toNum(r.master_list_count), approved_count: toNum(r.approved_count), achieved_count: toNum(r.achieved_count) })),
        fieldDays ? { ...Object.fromEntries(Object.entries(fieldDays).map(([k, v]) => [k, toNum(v)])), total_days: daysInMonth, field_days: computedFieldDays } : null
      );
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function saveActionPlan() {
    setBusy(true); setError("");
    try { await api.saveActionPlan(reportId, apRows); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function saveConversion() {
    setBusy(true); setError("");
    try {
      await api.saveConversion(reportId, convRows.map((r) => ({ ...r, current_rx_per_week: toNum(r.current_rx_per_week), competitor_rx_per_week: toNum(r.competitor_rx_per_week), target_rx_per_week: toNum(r.target_rx_per_week), actual_result_rx_per_week: r.actual_result_rx_per_week === "" ? null : toNum(r.actual_result_rx_per_week) })));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function savePotential() {
    setBusy(true); setError("");
    try {
      await api.savePotential(reportId, potRows.map((r) => ({ ...r, current_potential_per_week: toNum(r.current_potential_per_week), target_rx_per_week: toNum(r.target_rx_per_week), actual_result_rx_per_week: r.actual_result_rx_per_week === "" ? null : toNum(r.actual_result_rx_per_week) })));
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function addOpportunity() {
    if (!newOppName.trim()) return;
    setOppBusy(true); setOppError("");
    try { await api.addOpportunity(reportId, newOppName.trim()); setNewOppName(""); await load(); }
    catch (e) { setOppError(e.message); } finally { setOppBusy(false); }
  }
  async function saveOpportunityValues(oppId) {
    setOppBusy(true); setOppError("");
    try {
      const values = Object.entries(oppValues[oppId] || {}).map(([product_id, qty]) => ({ product_id, qty_packages: toNum(qty) }));
      await api.updateOpportunityValues(reportId, oppId, values);
      await load();
    } catch (e) { setOppError(e.message); } finally { setOppBusy(false); }
  }
  async function removeOpportunity(oppId) {
    if (!confirm("Удалить эту возможность?")) return;
    try { await api.deleteOpportunity(reportId, oppId); await load(); } catch (e) { setOppError(e.message); }
  }

  async function submit() {
    if (!confirm("Отправить отчёт на рассмотрение РМ? После отправки редактирование будет недоступно, пока РМ не вернёт отчёт на доработку.")) return;
    setBusy(true); setError("");
    try { await api.submitReport(reportId); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function approve() {
    setBusy(true); setError("");
    try { await api.approveReport(reportId, returnText); setReturnText(""); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function returnToMp() {
    if (!returnText.trim()) { setError("Укажите причину возврата"); return; }
    setBusy(true); setError("");
    try { await api.returnReport(reportId, returnText); setReturnText(""); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function addComment(section, item_ref, comment_text) {
    await api.addComment(reportId, { section, item_ref, comment_text });
    await load();
  }
  async function toggleNonReimb() {
    setBusy(true); setError("");
    try { await api.saveSettings(reportId, { non_reimbursement_ok: !report.non_reimbursement_ok }); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8">
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#6B7280" }}>← Назад к списку</button>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6 pb-6 border-b" style={{ borderColor: "#E4E7F0" }}>
        <div>
          <div className="font-display text-xl sm:text-2xl font-semibold">{mp.full_name}</div>
          <div className="text-sm" style={{ color: "#6B7280" }}>{mp.territory || "—"} · {monthName(report.period_month)} {report.period_year}</div>
          <span className="inline-block mt-2 text-xs px-2 py-1 rounded-full font-semibold" style={{ background: st.color + "22", color: st.color }}>{st.label}</span>
        </div>
        <div className="flex flex-col items-center">
          <Gauge achievement={fss.achievement} size={140} />
          <div className="text-xs mt-1" style={{ color: "#6B7280" }}>За месяц (справочно): <b style={{ color: "#ED3237" }}>{Math.round(fss.bonus_uzs).toLocaleString()} UZS</b></div>
        </div>
      </div>

      {error && <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#DC262622", color: "#DC2626" }}>{error}</div>}

      {/* Tabs — horizontally scrollable on mobile instead of overflowing */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0" style={{ scrollbarWidth: "thin" }}>
        {[["fss", "FSS"], ["ffe", "FFE"], ["conversion", "Конверсия"], ["potential", "Увеличение потенциала"], ["forecast", `Ожидания на ${monthName(report.period_month === 12 ? 1 : report.period_month + 1)}`], ["bonus", "Бонус"], ["comments", "История"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="px-4 py-2 rounded-lg text-sm font-medium shrink-0"
            style={{ background: tab === k ? "#ED3237" : "#F7F8FC", color: tab === k ? "#FFFFFF" : "#374151", border: "1px solid #E4E7F0" }}>
            {label}
          </button>
        ))}
      </div>

      {/* FSS TAB */}
      {tab === "fss" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="flex justify-end mb-2">
            {fssLocked ? (
              <div className="flex items-center gap-2 text-sm">
                <span style={{ color: "#16A34A" }}>✓ Сохранено</span>
                {editable && <button onClick={() => setFssLocked(false)} className="px-3 py-1 rounded text-xs" style={{ background: "#E4E7F0" }}>Изменить</button>}
              </div>
            ) : null}
          </div>
          {/* Desktop/tablet table */}
          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr style={{ color: "#6B7280", fontSize: 11 }} className="uppercase">
                <th className="text-left py-1">Препарат</th>
                <th className="text-right py-1 px-2">NRV $</th>
                <th className="text-right py-1 px-2">План, уп.</th>
                <th className="text-right py-1 px-2">Факт, уп.</th>
                <th className="text-right py-1 px-2">Δ, уп.</th>
                <th className="text-right py-1 px-2">Δ, $</th>
                <th className="text-right py-1">Дост.</th>
              </tr>
            </thead>
            <tbody>
              {liveFssItems.map((item, idx) => (
                <React.Fragment key={item.product_id}>
                  <tr style={{ borderTop: "1px solid #E4E7F0" }}>
                    <td className="py-1.5" style={{ color: "#374151" }}>{item.product_name}</td>
                    <td className="text-right px-2 font-mono" style={{ color: "#6B7280" }}>{Number(item.nrv_usd).toFixed(2)}</td>
                    <td className="text-right px-2">
                      {fssEditable ? (
                        <NumField value={fssRows[idx]?.target_qty ?? ""} onChange={(v) => setFssRows((r) => r.map((row, i) => i === idx ? { ...row, target_qty: v } : row))}
                          className="w-20 border-b text-right font-mono px-1" style={inputStyle()} />
                      ) : <span className="font-mono">{dispNum(item.target_qty)}</span>}
                    </td>
                    <td className="text-right px-2">
                      {fssEditable ? (
                        <NumField value={fssRows[idx]?.actual_qty ?? ""} onChange={(v) => setFssRows((r) => r.map((row, i) => i === idx ? { ...row, actual_qty: v } : row))}
                          className="w-20 border-b text-right font-mono px-1" style={inputStyle("#ED3237")} />
                      ) : <span className="font-mono" style={{ color: "#ED3237" }}>{dispNum(item.actual_qty)}</span>}
                    </td>
                    <td className="text-right px-2 font-mono" style={{ color: item.target_usd ? (item.actual_qty - item.target_qty >= 0 ? "#16A34A" : "#DC2626") : "#9CA3AF" }}>
                      {item.target_usd ? fmtDelta(item.actual_qty - item.target_qty) : "—"}
                    </td>
                    <td className="text-right px-2 font-mono" style={{ color: item.target_usd ? (item.actual_usd - item.target_usd >= 0 ? "#16A34A" : "#DC2626") : "#9CA3AF" }}>
                      {item.target_usd ? fmtDelta(item.actual_usd - item.target_usd, "$") : "—"}
                    </td>
                    <td className="text-right font-mono" style={{ color: item.target_usd ? achColor(item.actual_usd / item.target_usd) : "#6B7280" }}>
                      {item.target_usd ? `${((item.actual_usd / item.target_usd) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                  {!fssEditable && (
                    <tr><td colSpan={7}>
                      {isUnderperforming(item) && user.role === "mp" && (
                        <div className="text-xs mt-1" style={{ color: "#DC2626" }}>Бренд не выполнен — укажите причину ниже</div>
                      )}
                      <RowComments comments={comments} section="fss" itemRef={item.product_id} canComment={canComment || (user.role === "mp" && isUnderperforming(item))}
                        onAdd={(t) => addComment("fss", item.product_id, t)} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {liveFssItems.map((item, idx) => (
              <div key={item.product_id} className="rounded-xl p-3" style={{ background: "#EEF1F8" }}>
                <div className="flex justify-between items-start mb-2">
                  <div className="text-sm font-medium" style={{ color: "#374151" }}>{item.product_name}</div>
                  <div className="text-xs font-mono shrink-0 ml-2" style={{ color: "#6B7280" }}>${Number(item.nrv_usd).toFixed(2)}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <div className="text-[10px] uppercase mb-1" style={{ color: "#6B7280" }}>План, уп.</div>
                    {fssEditable ? (
                      <NumField value={fssRows[idx]?.target_qty ?? ""} onChange={(v) => setFssRows((r) => r.map((row, i) => i === idx ? { ...row, target_qty: v } : row))}
                        className="w-full border rounded px-2 py-1.5 font-mono text-sm" style={inputStyle()} />
                    ) : <div className="font-mono text-sm">{dispNum(item.target_qty)}</div>}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase mb-1" style={{ color: "#6B7280" }}>Факт, уп.</div>
                    {fssEditable ? (
                      <NumField value={fssRows[idx]?.actual_qty ?? ""} onChange={(v) => setFssRows((r) => r.map((row, i) => i === idx ? { ...row, actual_qty: v } : row))}
                        className="w-full border rounded px-2 py-1.5 font-mono text-sm" style={inputStyle("#ED3237")} />
                    ) : <div className="font-mono text-sm" style={{ color: "#ED3237" }}>{dispNum(item.actual_qty)}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase mb-1" style={{ color: "#6B7280" }}>Дост.</div>
                    <div className="font-mono text-sm py-1.5" style={{ color: item.target_usd ? achColor(item.actual_usd / item.target_usd) : "#6B7280" }}>
                      {item.target_usd ? `${((item.actual_usd / item.target_usd) * 100).toFixed(0)}%` : "—"}
                    </div>
                  </div>
                </div>
                {item.target_usd > 0 && (
                  <div className="text-xs font-mono mt-1 flex gap-3" style={{ color: item.actual_usd - item.target_usd >= 0 ? "#16A34A" : "#DC2626" }}>
                    <span>Δ уп.: {fmtDelta(item.actual_qty - item.target_qty)}</span>
                    <span>Δ $: {fmtDelta(item.actual_usd - item.target_usd, "$")}</span>
                  </div>
                )}
                {!fssEditable && (
                  <>
                    {isUnderperforming(item) && user.role === "mp" && (
                      <div className="text-xs mt-1" style={{ color: "#DC2626" }}>Бренд не выполнен — укажите причину ниже</div>
                    )}
                    <RowComments comments={comments} section="fss" itemRef={item.product_id} canComment={canComment || (user.role === "mp" && isUnderperforming(item))}
                      onAdd={(t) => addComment("fss", item.product_id, t)} />
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl p-4 flex flex-wrap items-center justify-between gap-2" style={{ background: "linear-gradient(90deg,#EEF1F8,#F7F8FC)" }}>
            <div>
              <div className="text-xs uppercase" style={{ color: "#6B7280" }}>Общее достижение, $</div>
              <div className="font-mono text-lg font-bold" style={{ color: achColor(liveFssTotals.achievement) }}>
                ${Math.round(liveFssTotals.actual_usd).toLocaleString()} / ${Math.round(liveFssTotals.target_usd).toLocaleString()} · {(liveFssTotals.achievement * 100).toFixed(1)}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase" style={{ color: "#6B7280" }}>Тариф</div>
              <div className="text-sm" style={{ color: "#ED3237" }}>{tierLabelClient(liveFssTotals.achievement)}</div>
            </div>
          </div>

          {liveFssTotals.target_usd + liveFssTotals.actual_usd > 0 && (
            <div className="mt-4 rounded-xl p-3" style={{ background: "#EEF1F8" }}>
              <div className="text-xs uppercase mb-2" style={{ color: "#6B7280" }}>План vs Факт по препаратам, $</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={liveFssItems.filter((i) => i.target_usd > 0 || i.actual_usd > 0).map((i) => ({ name: i.product_name.split(" ").slice(0, 2).join(" "), План: Math.round(i.target_usd), Факт: Math.round(i.actual_usd) }))}
                  margin={{ top: 5, right: 10, left: -10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7F0" vertical={false} />
                  <XAxis dataKey="name" stroke="#6B7280" fontSize={10} angle={-35} textAnchor="end" interval={0} />
                  <YAxis stroke="#6B7280" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #D3D8E4", borderRadius: 8, color: "#1F2937" }} />
                  <Legend />
                  <Bar dataKey="План" fill="#D3D8E4" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Факт" fill="#ED3237" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {fssEditable && <button onClick={async () => { await saveFss(); setFssLocked(true); }} disabled={busy} className="mt-4 px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить FSS</button>}
        </div>
      )}

      {/* FFE TAB */}
      {tab === "ffe" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-lg font-display">FFE score: <b style={{ color: ffe.score >= 0.85 ? "#16A34A" : "#DC2626" }}>{(ffe.score * 100).toFixed(1)}%</b></div>
              <div className="text-xs" style={{ color: "#6B7280" }}>минимум для допуска к бонусу — 85%</div>
            </div>
            {ffeLocked && (
              <div className="flex items-center gap-2 text-sm">
                <span style={{ color: "#16A34A" }}>✓ Сохранено</span>
                {editable && <button onClick={() => setFfeLocked(false)} className="px-3 py-1 rounded text-xs" style={{ background: "#E4E7F0" }}>Изменить</button>}
              </div>
            )}
          </div>

          <table className="w-full text-sm hidden md:table">
            <thead>
              <tr style={{ color: "#6B7280", fontSize: 11 }} className="uppercase">
                <th className="text-left py-1">Метрика</th>
                <th className="text-right px-2">В мастер-листе</th>
                <th className="text-right px-2">Утверждено</th>
                <th className="text-right px-2">Достигнуто</th>
                <th className="text-right px-2">Δ</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {liveFfeItems.map((item, idx) => {
                const denom = item.approved_count > 0 ? item.approved_count : item.master_list_count;
                const delta = item.achieved_count - denom;
                return (
                <React.Fragment key={item.metric_key}>
                  <tr style={{ borderTop: "1px solid #E4E7F0" }}>
                    <td className="py-1.5" style={{ color: "#374151" }}>{item.label}</td>
                    {["master_list_count", "approved_count", "achieved_count"].map((field) => (
                      <td key={field} className="text-right px-2">
                        {ffeEditable ? (
                          <NumField value={ffeRows[idx]?.[field] ?? ""} onChange={(v) => setFfeRows((r) => r.map((row, i) => i === idx ? { ...row, [field]: v } : row))}
                            className="w-16 border-b text-right font-mono px-1" style={inputStyle(field === "achieved_count" ? "#ED3237" : "#6B7280")} />
                        ) : <span className="font-mono">{dispNum(item[field])}</span>}
                      </td>
                    ))}
                    <td className="text-right px-2 font-mono" style={{ color: denom > 0 ? (delta >= 0 ? "#16A34A" : "#DC2626") : "#9CA3AF" }}>{denom > 0 ? fmtDelta(delta) : "—"}</td>
                    <td className="text-right font-mono" style={{ color: denom > 0 ? achColor(item.percent) : "#6B7280" }}>{denom > 0 ? `${(item.percent * 100).toFixed(0)}%` : "—"}</td>
                  </tr>
                  {!ffeEditable && (
                    <tr><td colSpan={6}><RowComments comments={comments} section="ffe" itemRef={item.id} canComment={canComment}
                      onAdd={(t) => addComment("ffe", item.id, t)} /></td></tr>
                  )}
                </React.Fragment>
              );})}
            </tbody>
          </table>

          <div className="md:hidden space-y-2">
            {liveFfeItems.map((item, idx) => {
              const denom = item.approved_count > 0 ? item.approved_count : item.master_list_count;
              const delta = item.achieved_count - denom;
              return (
              <div key={item.metric_key} className="rounded-xl p-3" style={{ background: "#EEF1F8" }}>
                <div className="flex justify-between items-center mb-2">
                  <div className="text-sm font-medium" style={{ color: "#374151" }}>{item.label}</div>
                  <div className="font-mono text-sm shrink-0 ml-2" style={{ color: denom > 0 ? achColor(item.percent) : "#6B7280" }}>{denom > 0 ? `${(item.percent * 100).toFixed(0)}%` : "—"}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[["master_list_count", "База"], ["approved_count", "Утв."], ["achieved_count", "Дост."]].map(([field, label]) => (
                    <div key={field}>
                      <div className="text-[10px] uppercase mb-1" style={{ color: "#6B7280" }}>{label}</div>
                      {ffeEditable ? (
                        <NumField value={ffeRows[idx]?.[field] ?? ""} onChange={(v) => setFfeRows((r) => r.map((row, i) => i === idx ? { ...row, [field]: v } : row))}
                          className="w-full border rounded px-2 py-1.5 font-mono text-sm" style={inputStyle(field === "achieved_count" ? "#ED3237" : "#6B7280")} />
                      ) : <div className="font-mono text-sm">{dispNum(item[field])}</div>}
                    </div>
                  ))}
                </div>
                {denom > 0 && (
                  <div className="text-xs font-mono mt-1" style={{ color: delta >= 0 ? "#16A34A" : "#DC2626" }}>Δ {fmtDelta(delta)}</div>
                )}
                {!ffeEditable && (
                  <RowComments comments={comments} section="ffe" itemRef={item.id} canComment={canComment}
                    onAdd={(t) => addComment("ffe", item.id, t)} />
                )}
              </div>
            );})}
          </div>

          {fieldDays && (() => {
            const daysInMonth = new Date(report.period_year, report.period_month, 0).getDate();
            const computedFieldDays = Math.max(0, daysInMonth - toNum(fieldDays.non_working_days) - toNum(fieldDays.public_holidays) - toNum(fieldDays.training_days) - toNum(fieldDays.leave_days));
            return (
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 text-xs">
                <div>
                  <div style={{ color: "#6B7280" }} className="mb-1">Дней в месяце</div>
                  <div className="font-mono py-1">{daysInMonth} <span style={{ color: "#8B96AA" }}>(авто)</span></div>
                </div>
                {[["non_working_days", "Выходные"], ["public_holidays", "Праздники"], ["training_days", "Тренинги"], ["leave_days", "Отпуск/б.лист"]].map(([k, label]) => (
                  <div key={k}>
                    <div style={{ color: "#6B7280" }} className="mb-1">{label}</div>
                    {ffeEditable ? (
                      <NumField value={fieldDays[k] ?? ""} onChange={(v) => setFieldDays((f) => ({ ...f, [k]: v }))}
                        className="w-full border rounded px-2 py-1 font-mono" style={inputStyle()} />
                    ) : <div className="font-mono">{dispNum(fieldDays[k])}</div>}
                  </div>
                ))}
                <div>
                  <div style={{ color: "#6B7280" }} className="mb-1">Дней в поле</div>
                  <div className="font-mono py-1" style={{ color: "#16A34A" }}>{computedFieldDays} <span style={{ color: "#8B96AA" }}>(авто)</span></div>
                </div>
              </div>
            );
          })()}
          {liveFfeItems.some((i) => (i.approved_count > 0 || i.master_list_count > 0)) && (
            <div className="mt-5 rounded-xl p-3" style={{ background: "#EEF1F8" }}>
              <div className="text-xs uppercase mb-2" style={{ color: "#6B7280" }}>FFE — профиль по метрикам</div>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={liveFfeItems.map((i) => ({ metric: i.label.replace(" — ", " "), pct: Math.round(i.percent * 100) }))}>
                  <PolarGrid stroke="#D3D8E4" />
                  <PolarAngleAxis dataKey="metric" stroke="#6B7280" fontSize={9} />
                  <PolarRadiusAxis domain={[0, 100]} stroke="#D3D8E4" fontSize={9} />
                  <Radar dataKey="pct" stroke="#ED3237" fill="#ED3237" fillOpacity={0.35} />
                  <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #D3D8E4", borderRadius: 8, color: "#1F2937" }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
          {ffeEditable && <button onClick={async () => { await saveFfe(); setFfeLocked(true); }} disabled={busy} className="mt-4 px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить FFE</button>}
        </div>
      )}

      {/* CONVERSION TAB */}
      {tab === "conversion" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="font-display text-lg">Конверсия врачей</div>
            {convLocked && (
              <div className="flex items-center gap-2 text-sm shrink-0">
                <span style={{ color: "#16A34A" }}>✓ Сохранено</span>
                {editable && <button onClick={() => setConvLocked(false)} className="px-3 py-1 rounded text-xs" style={{ background: "#E4E7F0" }}>Изменить</button>}
              </div>
            )}
          </div>
          <div className="text-xs mb-4" style={{ color: "#6B7280" }}>Врачи, которых МП планирует конвертировать с конкурентов в этом месяце</div>

          {convRows.map((row, idx) => (
            <div key={idx} className="rounded-xl p-3 mb-3" style={{ background: "#EEF1F8" }}>
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Препарат</div>
                  {convEditable ? (
                    <select value={row.product_id || ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, product_id: Number(e.target.value) } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                      <option value="" style={{ color: "#000" }}>— выбрать —</option>
                      {fss.items.map((p) => <option key={p.product_id} value={p.product_id} style={{ color: "#000" }}>{p.product_name}</option>)}
                    </select>
                  ) : <div>{row.product_name}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Врач (ФИО)</div>
                  {convEditable ? (
                    <input value={row.doctor_name || ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, doctor_name: e.target.value } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
                  ) : <div>{row.doctor_name}</div>}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Специальность врача</div>
                  {convEditable ? (
                    <select value={row.doctor_specialty || ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, doctor_specialty: e.target.value } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                      <option value="" style={{ color: "#000" }}>— выбрать —</option>
                      {SPECIALTIES.map((s) => <option key={s} value={s} style={{ color: "#000" }}>{s}</option>)}
                    </select>
                  ) : <div>{row.doctor_specialty || "—"}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>ЛПУ (мед. учреждение)</div>
                  {convEditable ? (
                    <input value={row.lpu_name || ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, lpu_name: e.target.value } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
                  ) : <div>{row.lpu_name || "—"}</div>}
                </div>
              </div>
              {row.previous_target_rx_per_week !== null && row.previous_target_rx_per_week !== undefined && (
                <div className="grid grid-cols-2 gap-2 text-sm mb-2 rounded-lg p-2" style={{ background: "#FFFFFF" }}>
                  <div>
                    <div className="text-xs mb-1" style={{ color: "#6B7280" }}>План прошлого месяца (зафиксирован)</div>
                    <div className="font-mono" style={{ color: "#6B7280" }}>{row.previous_target_rx_per_week} Rx/нед</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Факт достигнуто в этом месяце</div>
                    {convEditable ? <NumField value={row.actual_result_rx_per_week} onChange={(v) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, actual_result_rx_per_week: v } : x))}
                      className="w-full border rounded px-2 py-1.5 font-mono" style={inputStyle()} />
                      : <div className="font-mono">{dispNum(row.actual_result_rx_per_week)}</div>}
                    {row.actual_result_rx_per_week !== "" && row.actual_result_rx_per_week != null && (
                      <div className="text-xs mt-1" style={{ color: toNum(row.actual_result_rx_per_week) >= row.previous_target_rx_per_week ? "#16A34A" : "#DC2626" }}>
                        {toNum(row.actual_result_rx_per_week) >= row.previous_target_rx_per_week ? "✓ план выполнен" : "✗ план не выполнен"}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Наш преп., Rx/нед</div>
                  {convEditable ? <NumField value={row.current_rx_per_week} onChange={(v) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, current_rx_per_week: v } : x))}
                    className="w-full border rounded px-2 py-1.5 font-mono" style={inputStyle()} /> : <div className="font-mono">{dispNum(row.current_rx_per_week)}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Конкуренты, Rx/нед</div>
                  {convEditable ? <NumField value={row.competitor_rx_per_week} onChange={(v) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, competitor_rx_per_week: v } : x))}
                    className="w-full border rounded px-2 py-1.5 font-mono" style={inputStyle()} /> : <div className="font-mono">{dispNum(row.competitor_rx_per_week)}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Цель к концу месяца, Rx/нед</div>
                  {convEditable ? <NumField value={row.target_rx_per_week} onChange={(v) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, target_rx_per_week: v } : x))}
                    className="w-full border rounded px-2 py-1.5 font-mono" style={inputStyle("#ED3237")} /> : <div className="font-mono" style={{ color: "#ED3237" }}>{dispNum(row.target_rx_per_week)}</div>}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Почему выписывает конкурентов</div>
                  {convEditable ? <textarea rows={2} value={row.competitor_reason || ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, competitor_reason: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.competitor_reason}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>План действий МП (визит, активности)</div>
                  {convEditable ? <textarea rows={2} value={row.mp_action_plan || ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, mp_action_plan: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.mp_action_plan}</div>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Дата начала активности</div>
                  {convEditable ? <input type="date" value={row.start_date ? String(row.start_date).slice(0, 10) : ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, start_date: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.start_date ? String(row.start_date).slice(0, 10) : "—"}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Дата контроля с РМ</div>
                  {convEditable ? <input type="date" value={row.control_date ? String(row.control_date).slice(0, 10) : ""} onChange={(e) => setConvRows((r) => r.map((x, i) => i === idx ? { ...x, control_date: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.control_date ? String(row.control_date).slice(0, 10) : "—"}</div>}
                </div>
              </div>
              {editable && <button onClick={() => { setConvRows((r) => r.filter((_, i) => i !== idx)); setConvLocked(false); }} className="text-xs mt-2" style={{ color: "#DC2626" }}>Удалить врача</button>}
            </div>
          ))}

          {editable && (
            <div className="flex flex-wrap gap-3 mb-6">
              <button onClick={() => { setConvRows((r) => [...r, { product_id: "", doctor_name: "", doctor_specialty: "", lpu_name: "", current_rx_per_week: "", competitor_rx_per_week: "", competitor_reason: "", mp_action_plan: "", target_rx_per_week: "", start_date: "", control_date: "" }]); setConvLocked(false); }}
                className="px-3 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>+ добавить врача</button>
              {!convLocked && <button onClick={async () => { await saveConversion(); setConvLocked(true); }} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить Конверсию</button>}
            </div>
          )}

          {detail.conversion.summary.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2" style={{ color: "#374151" }}>Прогноз по брендам: база + конверсия</div>
              <table className="w-full text-sm">
                <thead><tr style={{ color: "#6B7280", fontSize: 11 }} className="uppercase">
                  <th className="text-left py-1">Препарат</th>
                  <th className="text-right px-2">База, уп.</th><th className="text-right px-2">+ Конв., уп.</th><th className="text-right px-2">Итого, уп.</th>
                  <th className="text-right px-2">База, $</th><th className="text-right px-2">+ Конв., $</th><th className="text-right">Итого, $</th>
                </tr></thead>
                <tbody>
                  {detail.conversion.summary.map((s) => (
                    <tr key={s.product_id} style={{ borderTop: "1px solid #E4E7F0" }}>
                      <td className="py-1.5">{s.product_name}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#6B7280" }}>{Math.round(s.base_packs).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#16A34A" }}>+{Math.round(s.additional_packs).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono font-semibold">{Math.round(s.total_packs).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#6B7280" }}>{Math.round(s.base_usd).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#16A34A" }}>+{Math.round(s.additional_usd).toLocaleString()}</td>
                      <td className="text-right font-mono font-semibold">{Math.round(s.total_usd).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={detail.conversion.summary.map((s) => ({ name: s.product_name.split(" ").slice(0, 2).join(" "), База: Math.round(s.base_usd), Конверсия: Math.round(s.additional_usd) }))}
                  margin={{ top: 10, right: 10, left: -10, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7F0" vertical={false} />
                  <XAxis dataKey="name" stroke="#6B7280" fontSize={10} angle={-30} textAnchor="end" interval={0} />
                  <YAxis stroke="#6B7280" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #D3D8E4", borderRadius: 8, color: "#1F2937" }} />
                  <Legend />
                  <Bar dataKey="База" stackId="a" fill="#D3D8E4" />
                  <Bar dataKey="Конверсия" stackId="a" fill="#16A34A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* POTENTIAL TAB */}
      {tab === "potential" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <div className="font-display text-lg">Увеличение потенциала</div>
            {potLocked && (
              <div className="flex items-center gap-2 text-sm shrink-0">
                <span style={{ color: "#16A34A" }}>✓ Сохранено</span>
                {editable && <button onClick={() => setPotLocked(false)} className="px-3 py-1 rounded text-xs" style={{ background: "#E4E7F0" }}>Изменить</button>}
              </div>
            )}
          </div>
          <div className="text-xs mb-4" style={{ color: "#6B7280" }}>Врачи, у которых МП планирует увеличить потенциал назначений в этом месяце</div>

          {potRows.map((row, idx) => (
            <div key={idx} className="rounded-xl p-3 mb-3" style={{ background: "#EEF1F8" }}>
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Препарат</div>
                  {potEditable ? (
                    <select value={row.product_id || ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, product_id: Number(e.target.value) } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                      <option value="" style={{ color: "#000" }}>— выбрать —</option>
                      {fss.items.map((p) => <option key={p.product_id} value={p.product_id} style={{ color: "#000" }}>{p.product_name}</option>)}
                    </select>
                  ) : <div>{row.product_name}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Врач (ФИО)</div>
                  {potEditable ? (
                    <input value={row.doctor_name || ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, doctor_name: e.target.value } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
                  ) : <div>{row.doctor_name}</div>}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Специальность врача</div>
                  {potEditable ? (
                    <select value={row.doctor_specialty || ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, doctor_specialty: e.target.value } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
                      <option value="" style={{ color: "#000" }}>— выбрать —</option>
                      {SPECIALTIES.map((s) => <option key={s} value={s} style={{ color: "#000" }}>{s}</option>)}
                    </select>
                  ) : <div>{row.doctor_specialty || "—"}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>ЛПУ (мед. учреждение)</div>
                  {potEditable ? (
                    <input value={row.lpu_name || ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, lpu_name: e.target.value } : x))}
                      className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
                  ) : <div>{row.lpu_name || "—"}</div>}
                </div>
              </div>
              {row.previous_target_rx_per_week !== null && row.previous_target_rx_per_week !== undefined && (
                <div className="grid grid-cols-2 gap-2 text-sm mb-2 rounded-lg p-2" style={{ background: "#FFFFFF" }}>
                  <div>
                    <div className="text-xs mb-1" style={{ color: "#6B7280" }}>План прошлого месяца (зафиксирован)</div>
                    <div className="font-mono" style={{ color: "#6B7280" }}>{row.previous_target_rx_per_week} Rx/нед</div>
                  </div>
                  <div>
                    <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Факт достигнуто в этом месяце</div>
                    {potEditable ? <NumField value={row.actual_result_rx_per_week} onChange={(v) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, actual_result_rx_per_week: v } : x))}
                      className="w-full border rounded px-2 py-1.5 font-mono" style={inputStyle()} />
                      : <div className="font-mono">{dispNum(row.actual_result_rx_per_week)}</div>}
                    {row.actual_result_rx_per_week !== "" && row.actual_result_rx_per_week != null && (
                      <div className="text-xs mt-1" style={{ color: toNum(row.actual_result_rx_per_week) >= row.previous_target_rx_per_week ? "#16A34A" : "#DC2626" }}>
                        {toNum(row.actual_result_rx_per_week) >= row.previous_target_rx_per_week ? "✓ план выполнен" : "✗ план не выполнен"}
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Текущий потенциал, Rx/нед</div>
                  {potEditable ? <NumField value={row.current_potential_per_week} onChange={(v) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, current_potential_per_week: v } : x))}
                    className="w-full border rounded px-2 py-1.5 font-mono" style={inputStyle()} /> : <div className="font-mono">{dispNum(row.current_potential_per_week)}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Цель к концу месяца, Rx/нед</div>
                  {potEditable ? <NumField value={row.target_rx_per_week} onChange={(v) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, target_rx_per_week: v } : x))}
                    className="w-full border rounded px-2 py-1.5 font-mono" style={inputStyle("#ED3237")} /> : <div className="font-mono" style={{ color: "#ED3237" }}>{dispNum(row.target_rx_per_week)}</div>}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-2">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Почему не лечит больше пациентов</div>
                  {potEditable ? <textarea rows={2} value={row.reason_not_treating || ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, reason_not_treating: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.reason_not_treating}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>План действий МП (визит, активности)</div>
                  {potEditable ? <textarea rows={2} value={row.mp_action_plan || ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, mp_action_plan: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.mp_action_plan}</div>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Дата начала активности</div>
                  {potEditable ? <input type="date" value={row.start_date ? String(row.start_date).slice(0, 10) : ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, start_date: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.start_date ? String(row.start_date).slice(0, 10) : "—"}</div>}
                </div>
                <div>
                  <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Дата контроля с РМ</div>
                  {potEditable ? <input type="date" value={row.control_date ? String(row.control_date).slice(0, 10) : ""} onChange={(e) => setPotRows((r) => r.map((x, i) => i === idx ? { ...x, control_date: e.target.value } : x))}
                    className="w-full bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} /> : <div>{row.control_date ? String(row.control_date).slice(0, 10) : "—"}</div>}
                </div>
              </div>
              {editable && <button onClick={() => { setPotRows((r) => r.filter((_, i) => i !== idx)); setPotLocked(false); }} className="text-xs mt-2" style={{ color: "#DC2626" }}>Удалить врача</button>}
            </div>
          ))}

          {editable && (
            <div className="flex flex-wrap gap-3 mb-6">
              <button onClick={() => { setPotRows((r) => [...r, { product_id: "", doctor_name: "", doctor_specialty: "", lpu_name: "", current_potential_per_week: "", reason_not_treating: "", mp_action_plan: "", target_rx_per_week: "", start_date: "", control_date: "" }]); setPotLocked(false); }}
                className="px-3 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>+ добавить врача</button>
              {!potLocked && <button onClick={async () => { await savePotential(); setPotLocked(true); }} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить Потенциал</button>}
            </div>
          )}

          {detail.potential.summary.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2" style={{ color: "#374151" }}>Прогноз по брендам: база + рост потенциала</div>
              <table className="w-full text-sm">
                <thead><tr style={{ color: "#6B7280", fontSize: 11 }} className="uppercase">
                  <th className="text-left py-1">Препарат</th>
                  <th className="text-right px-2">База, уп.</th><th className="text-right px-2">+ Потенц., уп.</th><th className="text-right px-2">Итого, уп.</th>
                  <th className="text-right px-2">База, $</th><th className="text-right px-2">+ Потенц., $</th><th className="text-right">Итого, $</th>
                </tr></thead>
                <tbody>
                  {detail.potential.summary.map((s) => (
                    <tr key={s.product_id} style={{ borderTop: "1px solid #E4E7F0" }}>
                      <td className="py-1.5">{s.product_name}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#6B7280" }}>{Math.round(s.base_packs).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#16A34A" }}>+{Math.round(s.additional_packs).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono font-semibold">{Math.round(s.total_packs).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#6B7280" }}>{Math.round(s.base_usd).toLocaleString()}</td>
                      <td className="text-right px-2 font-mono" style={{ color: "#16A34A" }}>+{Math.round(s.additional_usd).toLocaleString()}</td>
                      <td className="text-right font-mono font-semibold">{Math.round(s.total_usd).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={detail.potential.summary.map((s) => ({ name: s.product_name.split(" ").slice(0, 2).join(" "), База: Math.round(s.base_usd), Потенциал: Math.round(s.additional_usd) }))}
                  margin={{ top: 10, right: 10, left: -10, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4E7F0" vertical={false} />
                  <XAxis dataKey="name" stroke="#6B7280" fontSize={10} angle={-30} textAnchor="end" interval={0} />
                  <YAxis stroke="#6B7280" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#FFFFFF", border: "1px solid #D3D8E4", borderRadius: 8, color: "#1F2937" }} />
                  <Legend />
                  <Bar dataKey="База" stackId="a" fill="#D3D8E4" />
                  <Bar dataKey="Потенциал" stackId="a" fill="#7C3AED" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
      {/* SALES FORECAST TAB — база + конверсия + потенциал + возможности рынка */}
      {tab === "forecast" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="font-display text-lg mb-1">Ожидания по продажам на {monthName(detail.forecast.period_month)} {detail.forecast.period_year}</div>
          <div className="text-xs mb-4" style={{ color: "#6B7280" }}>
            База (текущие продажи) + воздействие Конверсии + воздействие Увеличения потенциала + Использование возможностей рынка
          </div>

          <div className="rounded-xl p-4 mb-4 flex flex-wrap items-center justify-between gap-3" style={{ background: "linear-gradient(90deg,#EEF1F8,#F7F8FC)" }}>
            <div>
              <div className="text-xs uppercase" style={{ color: "#6B7280" }}>Итоговое ожидание, $</div>
              <div className="font-mono text-xl font-bold" style={{ color: "#ED3237" }}>${Math.round(detail.forecast.totals.total_usd).toLocaleString()}</div>
            </div>
            {detail.forecast.totals.next_target_usd > 0 && (
              <>
                <div>
                  <div className="text-xs uppercase" style={{ color: "#6B7280" }}>План {monthName(detail.forecast.period_month)}, $</div>
                  <div className="font-mono text-xl">${Math.round(detail.forecast.totals.next_target_usd).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs uppercase" style={{ color: "#6B7280" }}>Прогнозное выполнение</div>
                  <div className="font-mono text-xl font-bold" style={{ color: achColor(detail.forecast.totals.achievement_pct) }}>{(detail.forecast.totals.achievement_pct * 100).toFixed(1)}%</div>
                </div>
              </>
            )}
            {!(detail.forecast.totals.next_target_usd > 0) && (
              <div className="text-xs" style={{ color: "#8B96AA" }}>План на {monthName(detail.forecast.period_month)} ещё не загружен — % выполнения появится после загрузки таргетов мастером</div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm mb-4">
              <thead>
                <tr style={{ color: "#6B7280", fontSize: 11 }} className="uppercase">
                  <th className="text-left py-1">Препарат</th>
                  <th className="text-right px-2">База, уп.</th>
                  <th className="text-right px-2">+Конв.</th>
                  <th className="text-right px-2">+Потенц.</th>
                  {detail.opportunities.map((o) => <th key={o.id} className="text-right px-2">{o.name}</th>)}
                  <th className="text-right px-2">Итого, уп.</th>
                  <th className="text-right">Итого, $</th>
                </tr>
              </thead>
              <tbody>
                {detail.forecast.items.map((f) => (
                  <tr key={f.product_id} style={{ borderTop: "1px solid #E4E7F0" }}>
                    <td className="py-1.5">{f.product_name}</td>
                    <td className="text-right px-2 font-mono" style={{ color: "#6B7280" }}>{Math.round(f.base_packs).toLocaleString()}</td>
                    <td className="text-right px-2 font-mono" style={{ color: "#16A34A" }}>{f.conv_packs ? `+${Math.round(f.conv_packs)}` : "—"}</td>
                    <td className="text-right px-2 font-mono" style={{ color: "#7C3AED" }}>{f.pot_packs ? `+${Math.round(f.pot_packs)}` : "—"}</td>
                    {detail.opportunities.map((o) => {
                      const v = (o.values.find((x) => x.product_id === f.product_id) || {}).qty_packages;
                      return <td key={o.id} className="text-right px-2 font-mono" style={{ color: "#ED3237" }}>{v ? `+${Math.round(v)}` : "—"}</td>;
                    })}
                    <td className="text-right px-2 font-mono font-semibold">{Math.round(f.total_packs).toLocaleString()}</td>
                    <td className="text-right font-mono font-semibold">${Math.round(f.total_usd).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="font-display text-base mb-3">Возможности на рынке</div>
          {detail.opportunities.map((o) => (
            <div key={o.id} className="rounded-xl p-3 mb-3" style={{ background: "#EEF1F8" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm">{o.name}</div>
                {editable && <button onClick={() => removeOpportunity(o.id)} className="text-xs" style={{ color: "#DC2626" }}>Удалить возможность</button>}
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {detail.fss.items.map((it) => (
                  <div key={it.product_id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{it.product_name}</span>
                    {editable ? (
                      <NumField value={oppValues[o.id]?.[it.product_id] ?? ""} onChange={(v) => setOppValues((s) => ({ ...s, [o.id]: { ...s[o.id], [it.product_id]: v } }))}
                        className="w-20 border rounded px-2 py-1 font-mono text-xs" style={inputStyle()} />
                    ) : (
                      <span className="font-mono text-xs">{dispNum((o.values.find((x) => x.product_id === it.product_id) || {}).qty_packages)}</span>
                    )}
                  </div>
                ))}
              </div>
              {editable && <button onClick={() => saveOpportunityValues(o.id)} disabled={oppBusy} className="mt-2 px-3 py-1.5 rounded text-xs font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Сохранить цифры</button>}
            </div>
          ))}

          {editable && (
            <div className="flex flex-wrap gap-2 items-center">
              <input value={newOppName} onChange={(e) => setNewOppName(e.target.value)} placeholder="Название возможности"
                className="border rounded px-2 py-1.5 text-sm flex-1" style={{ borderColor: "#D3D8E4", minWidth: "200px" }} />
              <button onClick={addOpportunity} disabled={oppBusy} className="px-4 py-1.5 rounded text-sm font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ Добавить возможность</button>
            </div>
          )}
          {oppError && <div className="text-xs mt-2" style={{ color: "#DC2626" }}>{oppError}</div>}
        </div>
      )}

      {tab === "bonus" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="font-display text-lg mb-1">Квартальный бонус (Q{Math.floor((report.period_month - 1) / 3) + 1}, {report.period_year})</div>
          <div className="text-xs mb-4" style={{ color: "#6B7280" }}>Бонус в политике считается по кварталу (3 месяца), а не по одному отчёту — здесь агрегация всех трёх.</div>
          {!quarterBonus ? <div className="text-sm" style={{ color: "#6B7280" }}>Загрузка…</div> : (
            <>
              <div className="grid sm:grid-cols-3 gap-3 mb-5">
                {quarterBonus.monthly.map((m) => (
                  <div key={m.month} className="rounded-xl p-3" style={{ background: "#EEF1F8" }}>
                    <div className="text-xs mb-1" style={{ color: "#6B7280" }}>Месяц {m.month}</div>
                    {m.found ? (
                      <>
                        <div className="text-xs mb-1" style={{ color: STATUS_LABEL[m.status]?.color }}>{STATUS_LABEL[m.status]?.label}</div>
                        <div className="font-mono text-sm">${Math.round(m.actual_usd).toLocaleString()} / ${Math.round(m.target_usd).toLocaleString()}</div>
                        <div className="text-xs mt-1" style={{ color: "#6B7280" }}>FFE: {(m.ffe_score * 100).toFixed(0)}%</div>
                      </>
                    ) : <div className="text-xs" style={{ color: "#DC2626" }}>Отчёт не создан</div>}
                  </div>
                ))}
              </div>

              <div className="space-y-2 text-sm mb-5">
                <Row label="Достижение плана за квартал" value={`${(quarterBonus.achievement * 100).toFixed(1)}%`} />
                <Row label="Тариф (согласно достижению)" value={quarterBonus.tier_label} />
                <Row label="Расчётный бонус (до гейтов)" value={`${Math.round(quarterBonus.raw_bonus_uzs).toLocaleString()} UZS`} />
                <Row label="Все 3 месяца одобрены РМ" value={quarterBonus.all_months_approved ? "✓ да" : "✗ нет — бонус не начисляется"} ok={quarterBonus.all_months_approved} />
                <Row label="FFE ≥ 85% (среднее за квартал)" value={`${(quarterBonus.ffe_score * 100).toFixed(1)}% ${quarterBonus.ffe_gate_passed ? "✓" : "✗"}`} ok={quarterBonus.ffe_gate_passed} />
                <Row label="≥50% плана — non-reimbursement продукты" value={quarterBonus.non_reimbursement_ok ? "✓ подтверждено" : "✗ не подтверждено"} ok={quarterBonus.non_reimbursement_ok} />
              </div>

              <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "linear-gradient(90deg,#EEF1F8,#F7F8FC)" }}>
                <div className="font-display text-base">ИТОГОВЫЙ бонус за квартал</div>
                <div className="font-mono text-xl font-bold" style={{ color: quarterBonus.bonus_uzs > 0 ? "#ED3237" : "#DC2626" }}>
                  {Math.round(quarterBonus.bonus_uzs).toLocaleString()} UZS
                </div>
              </div>
              <div className="text-xs mt-3" style={{ color: "#6B7280" }}>
                Также по политике: если 1-й месяц следующего квартала выполнен менее чем на 80%, бонус за текущий квартал аннулируется — платформа отслеживает это автоматически по мере заполнения следующих отчётов.
              </div>
            </>
          )}
          {canToggleGate && (
            <button onClick={toggleNonReimb} disabled={busy} className="mt-4 px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>
              {report.non_reimbursement_ok ? "Снять подтверждение non-reimbursement (этот месяц)" : "Подтвердить non-reimbursement (этот месяц)"}
            </button>
          )}
        </div>
      )}

      {/* COMMENTS / HISTORY TAB */}
      {tab === "comments" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="mb-6">
            <div className="font-display text-lg mb-3">Трекер отчёта</div>
            {detail.status_log.length === 0 ? (
              <div className="text-sm" style={{ color: "#6B7280" }}>Отчёт ещё не отправлялся</div>
            ) : (
              <div className="relative pl-6">
                <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: "#D3D8E4" }} />
                {detail.status_log.map((l) => {
                  const st = STATUS_LABEL[l.to_status] || { label: l.to_status, color: "#6B7280" };
                  return (
                    <div key={l.id} className="relative mb-4">
                      <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full" style={{ background: st.color, border: "2px solid #F7F8FC" }} />
                      <div className="text-sm font-semibold" style={{ color: st.color }}>{st.label}</div>
                      <div className="text-xs" style={{ color: "#6B7280" }}>{new Date(l.created_at).toLocaleString("ru-RU")} · {l.actor_name}</div>
                      {l.note && <div className="text-sm mt-1 rounded px-2 py-1" style={{ background: "#EEF1F8" }}>«{l.note}»</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <div className="font-display text-lg mb-2">Комментарии</div>
            {comments.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Пока нет комментариев</div>}
            {comments.map((c) => (
              <div key={c.id} className="text-sm rounded px-3 py-2 mb-2" style={{ background: "#EEF1F8" }}>
                <span style={{ color: "#ED3237" }} className="font-semibold">{c.author_name}</span>
                <span style={{ color: "#6B7280" }}> · {c.section} · {new Date(c.created_at).toLocaleString("ru-RU")}</span>
                <div>{c.comment_text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WORKFLOW ACTIONS */}
      <div className="mt-6 rounded-2xl p-4 sm:p-5 flex flex-wrap items-center gap-3" style={{ background: "#EEF1F8", border: "1px solid #E4E7F0" }}>
        {editable && (
          <button onClick={submit} disabled={busy} className="px-5 py-2.5 rounded font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>
            Отправить на рассмотрение РМ
          </button>
        )}
        {report.status === "returned" && (
          <div className="text-sm" style={{ color: "#DC2626" }}>Отчёт возвращён на доработку — см. комментарии выше.</div>
        )}
        {canReview && (
          <>
            <input value={returnText} onChange={(e) => setReturnText(e.target.value)} placeholder="Комментарий (обязателен при возврате)"
              className="flex-1 min-w-[200px] bg-transparent border rounded px-3 py-2 text-sm" style={{ borderColor: "#D3D8E4" }} />
            <button onClick={approve} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>Одобрить</button>
            <button onClick={returnToMp} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#DC2626", color: "#FFFFFF" }}>Вернуть на доработку</button>
          </>
        )}
        {report.status === "approved" && (
          <>
            <div className="text-sm font-semibold" style={{ color: "#16A34A" }}>✓ Отчёт одобрен</div>
            <button onClick={() => authedDownload(api.exportUrl(reportId, "xlsx"))} className="px-4 py-2 rounded" style={{ background: "#E4E7F0" }}>Скачать Excel</button>
            <button onClick={() => authedDownload(api.exportUrl(reportId, "pptx"))} className="px-4 py-2 rounded" style={{ background: "#E4E7F0" }}>Скачать презентацию</button>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, ok }) {
  return (
    <div className="flex justify-between items-center rounded-lg px-3 py-2" style={{ background: "#EEF1F8" }}>
      <span style={{ color: "#6B7280" }}>{label}</span>
      <span className="font-mono" style={{ color: ok === undefined ? "#1F2937" : ok ? "#16A34A" : "#DC2626" }}>{value}</span>
    </div>
  );
}
