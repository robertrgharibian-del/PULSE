import React, { useEffect, useState } from "react";
import { api } from "../api.js";

function Section({ title, children }) {
  if (!children || (Array.isArray(children) && children.length === 0)) return null;
  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">{title}</div>
      {children}
    </div>
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
        <div className="font-display text-2xl mb-3">NAVI не настроен</div>
        <div className="text-sm" style={{ color: "#6B7280" }}>
          Мастер-аккаунт ещё не подключил ИИ-анализ на сервере. Это делается один раз — добавляется ключ API в переменные окружения бэкенда, никому из пользователей ничего устанавливать не нужно.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <div className="font-display text-2xl font-semibold">NAVI</div>
          <div className="text-sm" style={{ color: "#6B7280" }}>
            Глубокий анализ динамики: месяц / квартал / год {data?.generated_at && `· обновлено ${new Date(data.generated_at).toLocaleString("ru-RU")}`}
          </div>
        </div>
        <button onClick={() => load(true)} disabled={busy} className="px-4 py-2 rounded font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>
          {busy ? "Анализирую…" : "Обновить анализ"}
        </button>
      </div>

      {error && <div className="text-sm mb-4 px-3 py-2 rounded" style={{ background: "#DC262622", color: "#DC2626" }}>{error}</div>}
      {!data && !error && <div style={{ color: "#6B7280" }}>Загрузка…</div>}

      {data && (
        <>
          <Section title="Главный вывод">
            <div className="text-sm leading-relaxed">{data.summary}</div>
          </Section>

          <Section title="Динамика месяц-к-месяцу">
            <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>{data.monthly_dynamics}</div>
          </Section>

          <Section title="Динамика квартал-к-кварталу">
            <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>{data.quarterly_dynamics}</div>
          </Section>

          <Section title="Динамика год-к-году">
            <div className="text-sm leading-relaxed" style={{ color: "#374151" }}>{data.yearly_dynamics}</div>
          </Section>

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
                  <li key={i} className="text-sm rounded px-3 py-2" style={{ background: "#ED323715", color: "#ED3237" }}>{r}</li>
                ))}
              </ul>
            </Section>
          )}

          {data.long_term_recommendations?.length > 0 && (
            <Section title="Рекомендации: долгосрочно (квартал+)">
              <ul className="space-y-2">
                {data.long_term_recommendations.map((r, i) => (
                  <li key={i} className="text-sm rounded px-3 py-2" style={{ background: "#16A34A15", color: "#16A34A" }}>{r}</li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
