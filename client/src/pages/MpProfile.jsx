import React, { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api.js";

function achColor(pct) {
  if (pct === null || pct === undefined) return "#8493AA";
  if (pct >= 0.9) return "#3FB88F";
  if (pct >= 0.8) return "#E8B04B";
  return "#E2574C";
}

const STATUS_LABEL = { draft: "Черновик", submitted: "На рассмотрении", returned: "На доработке", approved: "Одобрено" };

export default function MpProfile({ mpId, mpName, onBack }) {
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState("history");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const [planYear, setPlanYear] = useState(now.getFullYear());
  const [planMonth, setPlanMonth] = useState(now.getMonth() + 1);
  const [strengths, setStrengths] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [rmComment, setRmComment] = useState("");
  const [kpiRows, setKpiRows] = useState([]);

  async function load() {
    const p = await api.mpProfile(mpId);
    setProfile(p);
  }
  useEffect(() => { load(); }, [mpId]);

  useEffect(() => {
    if (!profile) return;
    const existing = profile.plans.find((pl) => pl.period_year === planYear && pl.period_month === planMonth);
    if (existing) {
      setStrengths(existing.strengths || "");
      setWeaknesses(existing.weaknesses || "");
      setRmComment(existing.rm_comment || "");
      const merged = (existing.kpis || []).map((k) => {
        const a = (existing.achieved_kpis || []).find((x) => x.name === k.name);
        return { name: k.name, baseline: k.baseline, target: k.target, achieved: a?.achieved ?? "" };
      });
      setKpiRows(merged);
    } else {
      setStrengths(""); setWeaknesses(""); setRmComment(""); setKpiRows([]);
    }
  }, [profile, planYear, planMonth]);

  async function savePlan() {
    setBusy(true); setError("");
    try {
      await api.saveDevelopmentPlan(mpId, {
        period_year: planYear, period_month: planMonth, strengths, weaknesses, rm_comment: rmComment,
        kpis: kpiRows.map((k) => ({ name: k.name, baseline: k.baseline, target: k.target })),
        achieved_kpis: kpiRows.map((k) => ({ name: k.name, achieved: k.achieved })),
      });
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!profile) return <div className="p-8" style={{ color: "#8493AA" }}>Загрузка…</div>;

  const chartData = profile.monthly.map((m) => ({ period: m.period, План: m.target_usd, Факт: m.actual_usd }));

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <button onClick={onBack} className="text-sm mb-4" style={{ color: "#8493AA" }}>← Назад к команде</button>
      <div className="mb-6">
        <div className="font-display text-2xl font-semibold">{profile.mp.full_name}</div>
        <div className="text-sm" style={{ color: "#8493AA" }}>{profile.mp.territory || "—"} {profile.mp.group_name ? `· ${profile.mp.group_name}` : ""}</div>
      </div>

      {profile.bonus && (
        <div className="rounded-2xl p-4 mb-6 flex flex-wrap gap-6 items-center" style={{ background: "linear-gradient(90deg,#1B2A44,#141F33)", border: "1px solid #22304A" }}>
          <div>
            <div className="text-xs uppercase" style={{ color: "#8493AA" }}>Достижение (Q{profile.bonus.quarter} {profile.bonus.year})</div>
            <div className="font-mono text-xl font-bold" style={{ color: achColor(profile.bonus.achievement) }}>{(profile.bonus.achievement * 100).toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-xs uppercase" style={{ color: "#8493AA" }}>Бонус за квартал</div>
            <div className="font-mono text-xl font-bold" style={{ color: "#E8B04B" }}>{Math.round(profile.bonus.bonus_uzs).toLocaleString()} UZS</div>
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="rounded-2xl p-4 mb-6" style={{ background: "#141F33", border: "1px solid #22304A" }}>
          <div className="text-xs uppercase mb-2" style={{ color: "#8493AA" }}>Динамика продаж, $</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#22304A" vertical={false} />
              <XAxis dataKey="period" stroke="#8493AA" fontSize={11} />
              <YAxis stroke="#8493AA" fontSize={11} />
              <Tooltip contentStyle={{ background: "#0E1726", border: "1px solid #3A4A66", borderRadius: 8, color: "#F5F0E6" }} />
              <Bar dataKey="План" fill="#3A4A66" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Факт" fill="#E8B04B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex gap-2 mb-5">
        {[["history", "История"], ["plan", "План развития"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: tab === k ? "#E8B04B" : "#141F33", color: tab === k ? "#0E1726" : "#C9D2E0", border: "1px solid #22304A" }}>
            {label}
          </button>
        ))}
      </div>

      {tab === "history" && (
        <div className="space-y-4">
          <div className="rounded-2xl p-4" style={{ background: "#141F33", border: "1px solid #22304A" }}>
            <div className="font-display text-lg mb-3">Отчёты</div>
            <div className="space-y-2">
              {profile.history.map((h) => (
                <div key={h.report_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3" style={{ background: "#1B2A44" }}>
                  <div className="text-sm">{h.period} · <span style={{ color: "#8493AA" }}>{STATUS_LABEL[h.status]}</span></div>
                  <div className="font-mono text-sm" style={{ color: achColor(h.achievement) }}>{h.achievement !== null ? `${(h.achievement * 100).toFixed(1)}%` : "—"}</div>
                </div>
              ))}
              {profile.history.length === 0 && <div className="text-sm" style={{ color: "#8493AA" }}>Отчётов пока нет</div>}
            </div>
          </div>
          <div className="rounded-2xl p-4" style={{ background: "#141F33", border: "1px solid #22304A" }}>
            <div className="font-display text-lg mb-3">Комментарии по отчётам</div>
            <div className="space-y-2">
              {profile.comments.map((c) => (
                <div key={c.id} className="text-sm rounded px-3 py-2" style={{ background: "#1B2A44" }}>
                  <span style={{ color: "#E8B04B" }} className="font-semibold">{c.author_name}</span>
                  <span style={{ color: "#8493AA" }}> · {c.period_month}/{c.period_year}</span>
                  <div>{c.comment_text}</div>
                </div>
              ))}
              {profile.comments.length === 0 && <div className="text-sm" style={{ color: "#8493AA" }}>Комментариев пока нет</div>}
            </div>
          </div>
        </div>
      )}

      {tab === "plan" && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "#141F33", border: "1px solid #22304A" }}>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="font-display text-lg">План развития</div>
            <select value={planMonth} onChange={(e) => setPlanMonth(Number(e.target.value))} className="bg-transparent border rounded px-2 py-1 text-sm" style={{ borderColor: "#3A4A66" }}>
              {["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"].map((m, i) => <option key={m} value={i + 1} style={{ color: "#000" }}>{m}</option>)}
            </select>
            <input type="number" value={planYear} onChange={(e) => setPlanYear(Number(e.target.value))} className="bg-transparent border rounded px-2 py-1 text-sm w-20" style={{ borderColor: "#3A4A66" }} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <div>
              <div className="text-xs uppercase mb-1" style={{ color: "#8493AA" }}>Сильные стороны</div>
              <textarea rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} className="w-full bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
            </div>
            <div>
              <div className="text-xs uppercase mb-1" style={{ color: "#8493AA" }}>Слабые стороны</div>
              <textarea rows={3} value={weaknesses} onChange={(e) => setWeaknesses(e.target.value)} className="w-full bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
            </div>
          </div>

          <div className="mb-4">
            <div className="text-xs uppercase mb-2" style={{ color: "#8493AA" }}>KPI (исходное → цель → достигнуто)</div>
            {kpiRows.map((k, idx) => (
              <div key={idx} className="grid grid-cols-5 gap-2 mb-2 text-sm items-center">
                <input value={k.name} onChange={(e) => setKpiRows((r) => r.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                  placeholder="Название KPI" className="col-span-2 bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#3A4A66" }} />
                <input value={k.baseline} onChange={(e) => setKpiRows((r) => r.map((x, i) => i === idx ? { ...x, baseline: e.target.value } : x))}
                  placeholder="Исходное" className="bg-transparent border rounded px-2 py-1.5 font-mono" style={{ borderColor: "#3A4A66" }} />
                <input value={k.target} onChange={(e) => setKpiRows((r) => r.map((x, i) => i === idx ? { ...x, target: e.target.value } : x))}
                  placeholder="Цель" className="bg-transparent border rounded px-2 py-1.5 font-mono" style={{ borderColor: "#3A4A66", color: "#E8B04B" }} />
                <input value={k.achieved} onChange={(e) => setKpiRows((r) => r.map((x, i) => i === idx ? { ...x, achieved: e.target.value } : x))}
                  placeholder="Достигнуто" className="bg-transparent border rounded px-2 py-1.5 font-mono" style={{ borderColor: "#3A4A66", color: "#3FB88F" }} />
              </div>
            ))}
            <button onClick={() => setKpiRows((r) => [...r, { name: "", baseline: "", target: "", achieved: "" }])} className="text-xs px-3 py-1.5 rounded" style={{ background: "#22304A" }}>+ добавить KPI</button>
          </div>

          <div className="mb-4">
            <div className="text-xs uppercase mb-1" style={{ color: "#8493AA" }}>Комментарий РМ (итоги месяца)</div>
            <textarea rows={3} value={rmComment} onChange={(e) => setRmComment(e.target.value)} className="w-full bg-transparent border rounded px-3 py-2" style={{ borderColor: "#3A4A66" }} />
          </div>

          {error && <div className="text-sm mb-3" style={{ color: "#E2574C" }}>{error}</div>}
          <button onClick={savePlan} disabled={busy} className="px-5 py-2.5 rounded font-semibold" style={{ background: "#3FB88F", color: "#0E1726" }}>
            {busy ? "Сохранение…" : "Сохранить план"}
          </button>

          {profile.plans.length > 0 && (
            <div className="mt-6 pt-4 border-t" style={{ borderColor: "#22304A" }}>
              <div className="text-sm font-semibold mb-2" style={{ color: "#C9D2E0" }}>История планов</div>
              <div className="space-y-2">
                {profile.plans.map((pl) => (
                  <div key={pl.id} className="text-xs rounded px-3 py-2" style={{ background: "#1B2A44", color: "#8493AA" }}>
                    {pl.period_month}/{pl.period_year} · {(pl.kpis || []).length} KPI {pl.rm_comment ? `· «${pl.rm_comment.slice(0, 60)}${pl.rm_comment.length > 60 ? "…" : ""}»` : ""}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
