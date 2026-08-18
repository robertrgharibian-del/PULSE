import React, { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { api } from "../api.js";

const NAVY = "#3E4095", RED = "#ED3237", MUTED = "#6B7280", PANEL = "#F7F8FC", LINE = "#E4E7F0", GREEN = "#16A34A";

function Section({ title, children, color }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-4" style={{ background: PANEL, border: `1px solid ${LINE}` }}>
      <div className="font-display text-lg mb-3" style={{ color: color || "#1F2937" }}>{title}</div>
      {children}
    </div>
  );
}

function AchievementChart({ months }) {
  if (!months || months.length === 0) return null;
  const data = months.map((m) => ({ period: m.period, "План, $": m.target_usd, "Факт, $": m.actual_usd }));
  return (
    <div className="mb-3">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
          <XAxis dataKey="period" stroke={MUTED} fontSize={11} />
          <YAxis stroke={MUTED} fontSize={11} />
          <Tooltip contentStyle={{ background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 8 }} />
          <Legend />
          <Bar dataKey="План, $" fill="#D3D8E4" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Факт, $" fill={RED} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AchievementLineChart({ series, dataKey }) {
  if (!series || series.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
        <XAxis dataKey={dataKey} stroke={MUTED} fontSize={11} />
        <YAxis stroke={MUTED} fontSize={11} unit="%" />
        <Tooltip contentStyle={{ background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 8 }} />
        <Line type="monotone" dataKey="achievement_pct" name="% выполнения" stroke={NAVY} strokeWidth={2} dot={{ fill: NAVY }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TeamBarChart({ people, nameKey, valueKey, label }) {
  if (!people || people.length === 0) return null;
  const data = people.map((p) => ({ name: p[nameKey], value: p[valueKey] })).filter((d) => d.value != null);
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={LINE} horizontal={false} />
        <XAxis type="number" stroke={MUTED} fontSize={11} unit="%" />
        <YAxis type="category" dataKey="name" stroke={MUTED} fontSize={11} width={120} />
        <Tooltip contentStyle={{ background: "#FFFFFF", border: `1px solid ${LINE}`, borderRadius: 8 }} />
        <Bar dataKey="value" name={label} fill={NAVY} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function AiInsights() {
  const [status, setStatus] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(refresh) {
    setBusy(true); setError("");
    try { setData(await api.aiInsights(refresh)); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    api.aiInsightsStatus().then((s) => { setStatus(s); if (s.enabled) load(false); });
  }, []);

  if (status && !status.enabled) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-5 py-16 text-center">
        <div className="font-display text-2xl mb-3">Аналитика не настроена</div>
        <div className="text-sm" style={{ color: MUTED }}>
          Мастер-аккаунт ещё не подключил ИИ-анализ на сервере. Это делается один раз — добавляется ключ API в переменные окружения бэкенда, никому из пользователей ничего устанавливать не нужно.
        </div>
      </div>
    );
  }

  const chart = data?.chart_data;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <div className="font-display text-2xl font-semibold">Аналитика</div>
          <div className="text-sm" style={{ color: MUTED }}>
            Глубокий анализ динамики: месяц / квартал / год {data?.generated_at && `· обновлено ${new Date(data.generated_at).toLocaleString("ru-RU")}`}
          </div>
        </div>
        <button onClick={() => load(true)} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: RED, color: "#FFFFFF" }}>
          {busy ? "Анализирую…" : "Обновить анализ"}
        </button>
      </div>

      {error && <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#DC262622", color: "#DC2626" }}>{error}</div>}
      {!data && !error && <div style={{ color: MUTED }}>Загрузка…</div>}

      {data?._truncated && (
        <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#FEF6E7", color: "#C58A1F" }}>
          Ответ ИИ был обрезан по лимиту длины. Нажмите «Обновить анализ» ещё раз — обычно помогает.
        </div>
      )}
      {(data?._team_error || data?._team_parse_error || data?._team_truncated) && (
        <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#FEF6E7", color: "#C58A1F" }}>
          {data._team_error || "Анализ по команде не удалось получить полностью. Основной анализ выше в порядке — попробуйте «Обновить анализ», чтобы дополнить его командной частью."}
        </div>
      )}

      {data && (
        <>
          <Section title="Главный вывод" color={NAVY}>
            <div className="text-sm leading-relaxed">{data.summary}</div>
          </Section>

          {chart?.months?.length > 0 && (
            <Section title="Динамика месяц-к-месяцу">
              <AchievementChart months={chart.months} />
              <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>{data.monthly_dynamics}</div>
            </Section>
          )}

          {chart?.quarterly?.length > 0 && (
            <Section title="Динамика квартал-к-кварталу">
              <AchievementLineChart series={chart.quarterly} dataKey="period" />
              <div className="text-sm leading-relaxed mt-2" style={{ color: "#374151" }}>{data.quarterly_dynamics}</div>
            </Section>
          )}

          {data.yearly_dynamics && (
            <Section title="Динамика год-к-году">
              <AchievementLineChart series={chart?.yearly?.map((y) => ({ ...y, period: y.year }))} dataKey="period" />
              <div className="text-sm leading-relaxed mt-2" style={{ color: "#374151" }}>{data.yearly_dynamics}</div>
            </Section>
          )}

          {data.conversion_potential_analysis && (
            <Section title="Конверсия и увеличение потенциала">
              <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>{data.conversion_potential_analysis}</div>
            </Section>
          )}

          {data.navi_analysis && (
            <Section title="Работа с трудными врачами (NAVI)">
              <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>{data.navi_analysis}</div>
            </Section>
          )}

          {data.risks?.length > 0 && (
            <Section title="Риски">
              <ul className="space-y-2">
                {data.risks.map((r, i) => (
                  <li key={i} className="text-sm rounded px-3 py-2" style={{ background: "#DC262615", color: "#DC2626" }}>{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {data.short_term_recommendations?.length > 0 && (
            <Section title="Рекомендации: краткосрочно (1-4 недели)">
              <ul className="space-y-2">
                {data.short_term_recommendations.map((r, i) => (
                  <li key={i} className="text-sm rounded px-3 py-2" style={{ background: "#ED323715", color: RED }}>{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {data.long_term_recommendations?.length > 0 && (
            <Section title="Рекомендации: долгосрочно (квартал+)">
              <ul className="space-y-2">
                {data.long_term_recommendations.map((r, i) => (
                  <li key={i} className="text-sm rounded px-3 py-2" style={{ background: "#16A34A15", color: GREEN }}>{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {chart?.per_mp?.length > 0 && (
            <Section title="Эффективность команды: медпредставители">
              <TeamBarChart people={chart.per_mp} nameKey="name" valueKey="latest_achievement_pct" label="% выполнения" />
            </Section>
          )}

          {chart?.per_rm?.length > 0 && (
            <Section title="Эффективность команды: региональные менеджеры">
              <TeamBarChart people={chart.per_rm} nameKey="name" valueKey="team_avg_achievement_pct" label="Средний % команды" />
            </Section>
          )}

          {data.team_analysis?.length > 0 && (
            <Section title="Анализ по каждому сотруднику">
              <div className="space-y-3">
                {data.team_analysis.map((p, i) => (
                  <div key={i} className="rounded-lg p-3" style={{ background: "#EEF1F8" }}>
                    <div className="font-semibold text-sm mb-1">{p.name} <span style={{ color: MUTED, fontWeight: 400 }}>· {p.role}</span></div>
                    <div className="text-sm" style={{ color: "#374151" }}>{p.assessment}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {data.employee_recommendations?.length > 0 && (
            <Section title="Рекомендации по развитию сотрудников">
              <div className="space-y-3">
                {data.employee_recommendations.map((p, i) => (
                  <div key={i} className="rounded-lg p-3" style={{ background: "#EEF1F8" }}>
                    <div className="font-semibold text-sm mb-2">{p.name} <span style={{ color: MUTED, fontWeight: 400 }}>· {p.role}</span></div>
                    <div className="grid sm:grid-cols-3 gap-2 text-xs">
                      <div><div className="uppercase font-semibold mb-1" style={{ color: RED }}>Месяц</div><div style={{ color: "#374151" }}>{p.monthly}</div></div>
                      <div><div className="uppercase font-semibold mb-1" style={{ color: RED }}>Квартал</div><div style={{ color: "#374151" }}>{p.quarterly}</div></div>
                      <div><div className="uppercase font-semibold mb-1" style={{ color: RED }}>Год</div><div style={{ color: "#374151" }}>{p.yearly}</div></div>
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {data.business_recommendations && (
            <Section title="Рекомендации по развитию бизнеса" color={NAVY}>
              <div className="grid sm:grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg p-3" style={{ background: "#EEF1F8" }}><div className="uppercase font-semibold mb-1 text-xs" style={{ color: RED }}>Месяц</div>{data.business_recommendations.monthly}</div>
                <div className="rounded-lg p-3" style={{ background: "#EEF1F8" }}><div className="uppercase font-semibold mb-1 text-xs" style={{ color: RED }}>Квартал</div>{data.business_recommendations.quarterly}</div>
                <div className="rounded-lg p-3" style={{ background: "#EEF1F8" }}><div className="uppercase font-semibold mb-1 text-xs" style={{ color: RED }}>Год</div>{data.business_recommendations.yearly}</div>
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
