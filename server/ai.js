// Deep AI analysis of sales dynamics (month/quarter/year) — runs entirely
// server-side. Requires ANTHROPIC_API_KEY to be set (see .env.example);
// no end user needs to install or configure anything.

const AI_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const aiEnabled = !!process.env.ANTHROPIC_API_KEY;

function quarterOf(month) { return Math.floor((month - 1) / 3) + 1; }

/**
 * Pulls all approved reports for a set of MP ids and returns per-month
 * aggregated totals plus per-MP breakdown, ready to hand to the model as
 * structured context (no raw DB rows).
 */
async function buildAnalyticsContext(pool, { mpIds, label }) {
  if (mpIds.length === 0) return null;

  const reportsRes = await pool.query(
    `select r.id, r.mp_id, r.period_year, r.period_month, r.status, u.full_name as mp_name, u.territory
     from reports r join users u on u.id = r.mp_id
     where r.mp_id = any($1::bigint[]) and r.status = 'approved'
     order by r.period_year, r.period_month`,
    [mpIds]
  );
  const reports = reportsRes.rows;
  if (reports.length === 0) return { label, months: [], note: "Нет одобренных отчётов для анализа" };

  const reportIds = reports.map((r) => r.id);
  const fssRes = await pool.query(
    `select f.report_id, f.target_qty, f.actual_qty, p.name as product_name, p.nrv_usd
     from report_fss f join products p on p.id = f.product_id where f.report_id = any($1::bigint[])`,
    [reportIds]
  );
  const ffeRes = await pool.query(
    `select report_id, metric_key, master_list_count, approved_count, achieved_count
     from report_ffe where report_id = any($1::bigint[])`,
    [reportIds]
  );
  const notesRes = await pool.query(
    `select report_id, comment_text, section, author_role from report_comments
     where report_id = any($1::bigint[]) and section='fss' order by created_at desc limit 60`,
    [reportIds]
  );

  const fssByReport = {};
  for (const row of fssRes.rows) {
    (fssByReport[row.report_id] ||= []).push(row);
  }
  const ffeByReport = {};
  for (const row of ffeRes.rows) {
    (ffeByReport[row.report_id] ||= []).push(row);
  }

  // per-month aggregate (across all mpIds combined) + per-MP monthly totals
  const monthly = {}; // key "YYYY-M" -> { target_usd, actual_usd, ffe_avg, byProduct }
  const perMp = {};   // mp_id -> [{ year, month, target_usd, actual_usd }]

  for (const r of reports) {
    const key = `${r.period_year}-${r.period_month}`;
    const items = fssByReport[r.id] || [];
    let target_usd = 0, actual_usd = 0;
    const byProduct = {};
    for (const it of items) {
      const t = Number(it.target_qty) * Number(it.nrv_usd);
      const a = Number(it.actual_qty) * Number(it.nrv_usd);
      target_usd += t; actual_usd += a;
      byProduct[it.product_name] = (byProduct[it.product_name] || 0) + a;
    }
    const ffeItems = ffeByReport[r.id] || [];
    const ffeScores = ffeItems.map((f) => {
      const denom = f.approved_count > 0 ? f.approved_count : f.master_list_count;
      return denom > 0 ? f.achieved_count / denom : null;
    }).filter((x) => x !== null);
    const ffeAvg = ffeScores.length ? ffeScores.reduce((s, x) => s + x, 0) / ffeScores.length : null;

    if (!monthly[key]) monthly[key] = { year: r.period_year, month: r.period_month, target_usd: 0, actual_usd: 0, ffe_sum: 0, ffe_count: 0, byProduct: {} };
    monthly[key].target_usd += target_usd;
    monthly[key].actual_usd += actual_usd;
    if (ffeAvg !== null) { monthly[key].ffe_sum += ffeAvg; monthly[key].ffe_count += 1; }
    for (const [name, usd] of Object.entries(byProduct)) {
      monthly[key].byProduct[name] = (monthly[key].byProduct[name] || 0) + usd;
    }

    (perMp[r.mp_id] ||= { name: r.mp_name, territory: r.territory, months: [] }).months.push({
      year: r.period_year, month: r.period_month, target_usd, actual_usd,
      achievement: target_usd ? actual_usd / target_usd : null,
    });
  }

  const monthsSorted = Object.values(monthly).sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const monthsOut = monthsSorted.map((m) => ({
    period: `${m.year}-${String(m.month).padStart(2, "0")}`,
    target_usd: Math.round(m.target_usd),
    actual_usd: Math.round(m.actual_usd),
    achievement_pct: m.target_usd ? Math.round((m.actual_usd / m.target_usd) * 1000) / 10 : null,
    ffe_score_pct: m.ffe_count ? Math.round((m.ffe_sum / m.ffe_count) * 1000) / 10 : null,
    top_products: Object.entries(m.byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, usd]) => ({ name, usd: Math.round(usd) })),
  }));

  // quarterly + yearly rollups from the monthly series
  const quarterly = {};
  const yearly = {};
  for (const m of monthsSorted) {
    const qKey = `${m.year}-Q${quarterOf(m.month)}`;
    quarterly[qKey] ||= { target_usd: 0, actual_usd: 0 };
    quarterly[qKey].target_usd += m.target_usd;
    quarterly[qKey].actual_usd += m.actual_usd;
    yearly[m.year] ||= { target_usd: 0, actual_usd: 0 };
    yearly[m.year].target_usd += m.target_usd;
    yearly[m.year].actual_usd += m.actual_usd;
  }
  const quarterlyOut = Object.entries(quarterly).map(([period, v]) => ({
    period, target_usd: Math.round(v.target_usd), actual_usd: Math.round(v.actual_usd),
    achievement_pct: v.target_usd ? Math.round((v.actual_usd / v.target_usd) * 1000) / 10 : null,
  }));
  const yearlyOut = Object.entries(yearly).map(([year, v]) => ({
    year, target_usd: Math.round(v.target_usd), actual_usd: Math.round(v.actual_usd),
    achievement_pct: v.target_usd ? Math.round((v.actual_usd / v.target_usd) * 1000) / 10 : null,
  }));

  const perMpOut = Object.values(perMp).map((mp) => {
    const last = mp.months[mp.months.length - 1];
    return { name: mp.name, territory: mp.territory, latest_achievement_pct: last?.achievement != null ? Math.round(last.achievement * 1000) / 10 : null, months_reported: mp.months.length };
  }).sort((a, b) => (a.latest_achievement_pct ?? 0) - (b.latest_achievement_pct ?? 0));

  return {
    label,
    months: monthsOut,
    quarterly: quarterlyOut,
    yearly: yearlyOut,
    per_mp: perMpOut,
    underperformance_notes: notesRes.rows.map((n) => n.comment_text).slice(0, 20),
  };
}

const NO_DASH_RULE = "Никогда не используй длинное тире (—) или короткое тире (–) — только обычный дефис (-) или перестрой предложение. Не используй markdown-разметку.";

async function callClaude(context) {
  const system = `Ты — senior аналитик фармацевтических продаж (field force effectiveness) для команды медпредставителей в Узбекистане.
Тебе дают структурированные данные по вторичным продажам (FSS): план/факт по месяцам, кварталам, годам, в долларах, плюс FFE score, плюс комментарии медпредов о причинах невыполнения.
Дай ГЛУБОКИЙ анализ: тренды месяц-к-месяцу, квартал-к-кварталу, год-к-году, аномалии, риски, сильные и слабые препараты/территории.
${NO_DASH_RULE}
Отвечай СТРОГО в формате JSON (без markdown-разметки, без \`\`\`), на русском языке, со следующей структурой:
{
  "summary": "2-4 предложения — главный вывод",
  "monthly_dynamics": "анализ динамики месяц-к-месяцу",
  "quarterly_dynamics": "анализ динамики квартал-к-кварталу",
  "yearly_dynamics": "анализ динамики год-к-году (если данных недостаточно — так и напиши)",
  "risks": ["риск 1", "риск 2", ...],
  "short_term_recommendations": ["конкретная рекомендация на 1-4 недели", ...],
  "long_term_recommendations": ["стратегическая рекомендация на квартал+", ...]
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: JSON.stringify(context) }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  try {
    return JSON.parse(text);
  } catch (e) {
    return { summary: text, monthly_dynamics: "", quarterly_dynamics: "", yearly_dynamics: "", risks: [], short_term_recommendations: [], long_term_recommendations: [] };
  }
}

/**
 * NAVI — pre-visit coaching. Analyzes a doctor's profile, the MP's pre-visit
 * plan (goal + per-brand current/potential/competitors/target), the full
 * visit history, and the group's available Portfolio Visual Aid slides and
 * Promo materials, then returns a structured, sectioned recommendation in
 * the MP's current UI language (ru/uz) — no separate setup needed.
 */
async function callClaudeForNavi(context, lang) {
  const langName = lang === "uz" ? "узбекском (o'zbek tili, латиница)" : "русском";
  const system = `Ты — NAVI, опытный полевой ИИ-коуч для медицинских представителей фармацевтической компании MSN в Узбекистане.
Тебе дают: карточку врача (специальность, стаж, психотип, время на визит, потребности, поведение), план МП на сегодняшний визит
(цель визита текстом + по каждому бренду: сколько врач уже назначает в неделю, его общий потенциал по этому диагнозу в неделю,
каких конкурентов и сколько он назначает, целевая цифра назначений нашего бренда, которую МП хочет получить по итогам визита),
полную историю прошлых визитов (что советовала NAVI, что МП реально сделал, и результаты прошлых визитов: сколько фактически
назначает по брендам в месяц и о чём договорились на прошлых визитах), а также список доступных материалов из Портфолио:
слайды Visual Aid (с их содержанием и целью) и промо материалы (с их типом, аудиторией и содержанием) по брендам этого визита.

Проанализируй прогресс от визита к визиту и дай КОНКРЕТНЫЕ, реалистичные, применимые на практике рекомендации.
${NO_DASH_RULE}
Отвечай СТРОГО в формате JSON (без markdown, без \`\`\`), на ${langName} языке, со следующими ключами (каждый — связный текст абзацами, не список с звёздочками):
{
  "prior_analysis": "краткий анализ предыдущей работы с этим врачом: что уже пробовали, что сработало, что нет",
  "general_recommendations": "общие рекомендации по сегодняшнему визиту",
  "technique": "какую технику визита (или комбинацию техник, например SPIN, Challenger Sale, Consultative Selling и т.п.) стоит использовать и почему, с учётом психотипа врача",
  "what_to_say": "что и как конкретно нужно говорить на визите",
  "what_to_avoid": "чего нужно избегать на этом визите",
  "must_not_do": "чего категорически делать нельзя с этим врачом",
  "timing": "тайминг визита поминутно, с учётом отведённого времени (например: 0-1 мин — приветствие, 1-3 мин — ... и т.д.)",
  "closing": "как сделать договорённость в конце визита, конкретная формулировка просьбы",
  "visual_aid_id": <id слайда из списка available_visual_aids, который лучше всего использовать на этом визите, или null если ни один не подходит>,
  "visual_aid_script": "если visual_aid_id указан: что именно из этого слайда и как озвучить врачу; иначе пустая строка",
  "promo_material_id": <id материала из списка available_promo_materials, который лучше всего использовать, или null>,
  "promo_material_script": "если promo_material_id указан: что именно из этого материала и как озвучить врачу; иначе пустая строка"
}
Выбирай visual_aid_id и promo_material_id ТОЛЬКО из id, реально присутствующих в переданных списках available_visual_aids/available_promo_materials. Если списки пустые — оба поля null.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 2500,
      system,
      messages: [{ role: "user", content: JSON.stringify(context) }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("").trim();
  try {
    const parsed = JSON.parse(text);
    return {
      prior_analysis: parsed.prior_analysis || "", general_recommendations: parsed.general_recommendations || "",
      technique: parsed.technique || "", what_to_say: parsed.what_to_say || "", what_to_avoid: parsed.what_to_avoid || "",
      must_not_do: parsed.must_not_do || "", timing: parsed.timing || "", closing: parsed.closing || "",
      visual_aid_id: parsed.visual_aid_id || null, visual_aid_script: parsed.visual_aid_script || "",
      promo_material_id: parsed.promo_material_id || null, promo_material_script: parsed.promo_material_script || "",
    };
  } catch (e) {
    return { prior_analysis: text, general_recommendations: "", technique: "", what_to_say: "", what_to_avoid: "", must_not_do: "", timing: "", closing: "", visual_aid_id: null, visual_aid_script: "", promo_material_id: null, promo_material_script: "" };
  }
}

module.exports = { aiEnabled, AI_MODEL, buildAnalyticsContext, callClaude, callClaudeForNavi };
