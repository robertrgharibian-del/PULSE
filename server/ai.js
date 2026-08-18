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
async function buildAnalyticsContext(pool, { mpIds, label, scope, rmIds }) {
  if (mpIds.length === 0) return null;

  const reportsRes = await pool.query(
    `select r.id, r.mp_id, r.period_year, r.period_month, r.status, u.full_name as mp_name, u.territory, u.rm_id
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
  // Conversion / Potential: previous month's plan vs this month's reported actual
  const convRes = await pool.query(
    `select report_id, previous_target_rx_per_week, actual_result_rx_per_week from report_conversion
     where report_id = any($1::bigint[]) and previous_target_rx_per_week is not null`,
    [reportIds]
  );
  const potRes = await pool.query(
    `select report_id, previous_target_rx_per_week, actual_result_rx_per_week from report_potential
     where report_id = any($1::bigint[]) and previous_target_rx_per_week is not null`,
    [reportIds]
  );
  // NAVI: doctor coaching workload + how many coached visits translated into a reported increase
  const naviRes = await pool.query(
    `select v.id, v.doctor_id, v.mp_report, v.post_visit_brands, v.reported_at
     from navi_visits v join navi_doctors d on d.id=v.doctor_id
     where d.mp_id = any($1::bigint[])`,
    [mpIds]
  );
  const naviDoctorsRes = await pool.query("select count(*) as n from navi_doctors where mp_id = any($1::bigint[])", [mpIds]);

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

    (perMp[r.mp_id] ||= { name: r.mp_name, territory: r.territory, rm_id: r.rm_id, months: [] }).months.push({
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

  const reportIdToMpId = Object.fromEntries(reports.map((r) => [r.id, r.mp_id]));

  function convPotSummary(rows) {
    let planSum = 0, factSum = 0, reportedCount = 0, totalCount = 0;
    const byMp = {};
    for (const row of rows) {
      const plan = Number(row.previous_target_rx_per_week);
      const hasFact = row.actual_result_rx_per_week !== null && row.actual_result_rx_per_week !== undefined;
      const fact = hasFact ? Number(row.actual_result_rx_per_week) : 0;
      planSum += plan; factSum += fact; totalCount += 1;
      if (hasFact) reportedCount += 1;
      const mpId = reportIdToMpId[row.report_id];
      if (mpId) {
        byMp[mpId] ||= { plan: 0, fact: 0 };
        byMp[mpId].plan += plan; byMp[mpId].fact += fact;
      }
    }
    return {
      achievement_pct: planSum ? Math.round((factSum / planSum) * 1000) / 10 : null,
      doctors_with_plan: totalCount, doctors_reported: reportedCount,
      byMp,
    };
  }
  const conversionSummary = convPotSummary(convRes.rows);
  const potentialSummary = convPotSummary(potRes.rows);

  const naviCompletedVisits = naviRes.rows.filter((v) => v.reported_at);
  const naviSuccessfulVisits = naviCompletedVisits.filter((v) => Array.isArray(v.post_visit_brands) && v.post_visit_brands.some((b) => Number(b.monthly_qty) > 0));
  const naviSummary = {
    doctors_tracked: Number(naviDoctorsRes.rows[0]?.n || 0),
    visits_started: naviRes.rows.length,
    visits_completed: naviCompletedVisits.length,
    visits_with_positive_result: naviSuccessfulVisits.length,
    sample_outcomes: naviCompletedVisits.slice(0, 15).map((v) => v.mp_report).filter(Boolean),
  };

  const perMpOut = Object.values(perMp).map((mp) => {
    const last = mp.months[mp.months.length - 1];
    const avgAchievement = mp.months.filter((m) => m.achievement !== null).reduce((s, m, _, arr) => s + m.achievement / arr.length, 0);
    return {
      name: mp.name, territory: mp.territory,
      latest_achievement_pct: last?.achievement != null ? Math.round(last.achievement * 1000) / 10 : null,
      avg_achievement_pct: mp.months.length ? Math.round(avgAchievement * 1000) / 10 : null,
      months_reported: mp.months.length,
    };
  }).sort((a, b) => (a.latest_achievement_pct ?? 0) - (b.latest_achievement_pct ?? 0));

  // Per-RM rollup (only meaningful for the master/whole-company scope)
  let perRmOut = [];
  if (scope === "master") {
    const byRm = {};
    for (const mp of Object.values(perMp)) {
      if (!mp.rm_id) continue;
      byRm[mp.rm_id] ||= { mp_count: 0, achievements: [] };
      byRm[mp.rm_id].mp_count += 1;
      const last = mp.months[mp.months.length - 1];
      if (last?.achievement != null) byRm[mp.rm_id].achievements.push(last.achievement);
    }
    if (Object.keys(byRm).length && rmIds?.length) {
      const rmNamesRes = await pool.query("select id, full_name, territory from users where id = any($1::bigint[])", [rmIds]);
      const rmNameById = Object.fromEntries(rmNamesRes.rows.map((r) => [r.id, { name: r.full_name, territory: r.territory }]));
      perRmOut = Object.entries(byRm).map(([rmId, v]) => ({
        name: rmNameById[rmId]?.name || `РМ #${rmId}`, territory: rmNameById[rmId]?.territory,
        mp_count: v.mp_count,
        team_avg_achievement_pct: v.achievements.length ? Math.round((v.achievements.reduce((s, x) => s + x, 0) / v.achievements.length) * 1000) / 10 : null,
      }));
    }
  }

  return {
    label,
    months: monthsOut,
    quarterly: quarterlyOut,
    yearly: yearlyOut,
    per_mp: perMpOut,
    per_rm: perRmOut,
    conversion_summary: conversionSummary,
    potential_summary: potentialSummary,
    navi_summary: naviSummary,
    underperformance_notes: notesRes.rows.map((n) => n.comment_text).slice(0, 20),
  };
}

const NO_DASH_RULE = "Никогда не используй длинное тире (—) или короткое тире (–) — только обычный дефис (-) или перестрой предложение. Не используй markdown-разметку.";

// Robustly pull a JSON object out of a model response: strips ```json fences
// if present, then falls back to the outermost {...} span if there's any
// stray text around the JSON.
function extractJson(text) {
  let t = text.trim();
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) t = fenceMatch[1].trim();
  try { return JSON.parse(t); } catch (e) {}
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) {}
  }
  return null;
}

async function callAnthropic(system, context, maxTokens) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: JSON.stringify(context) }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const stopReason = data.stop_reason;
  const text = (data.content || []).map((b) => b.text || "").join("");
  const parsed = extractJson(text);
  return { parsed, stopReason, rawLength: text.length };
}

const CORE_SCHEMA = `{
  "summary": "3-5 предложений — главный вывод",
  "monthly_dynamics": "подробный анализ динамики месяц-к-месяцу",
  "quarterly_dynamics": "подробный анализ динамики квартал-к-кварталу",
  "yearly_dynamics": "анализ динамики год-к-году (если данных недостаточно — так и напиши)",
  "conversion_potential_analysis": "анализ качества работы по Конверсии врачей и по Увеличению потенциала: выполняются ли планы, где проблемы",
  "navi_analysis": "анализ работы с трудными врачами через NAVI: масштаб охвата, результативность визитов",
  "risks": ["риск 1", "риск 2", ...],
  "short_term_recommendations": ["конкретная рекомендация на 1-4 недели", ...],
  "long_term_recommendations": ["стратегическая рекомендация на квартал+", ...]
}`;

/** Core narrative analysis: trends, risks, recommendations. Has its own token budget so it never competes with the (potentially large) team breakdown for space. */
async function callClaude(context) {
  const system = `Ты — senior аналитик фармацевтических продаж (field force effectiveness) для команды медпредставителей в Узбекистане.
Тебе дают структурированные данные: план/факт продаж (FSS) по месяцам/кварталам/годам в долларах, FFE score, комментарии медпредов о причинах невыполнения,
сводку по работе с Конверсией врачей (сколько было запланировано и сколько реально достигнуто), сводку по работе с Увеличением потенциала (аналогично),
сводку по работе NAVI с "трудными" врачами (сколько врачей под наблюдением, сколько визитов проведено, сколько дали положительный результат).
Дай ГЛУБОКИЙ, содержательный анализ: тренды месяц-к-месяцу, квартал-к-кварталу, год-к-году, аномалии, риски, сильные и слабые препараты/территории,
качество работы по конверсии и увеличению потенциала, эффективность работы NAVI с трудными врачами.
${NO_DASH_RULE}
Отвечай СТРОГО в формате JSON (без markdown-разметки, без \`\`\`), на русском языке, ЦЕЛИКОМ ПОМЕЩАЯСЬ в разумный объём (2-4 абзаца на каждый текстовый пункт, не эссе), со следующей структурой:
${CORE_SCHEMA}
Отвечай по существу, с конкретными цифрами из переданных данных, без общих фраз. Обязательно заверши JSON полностью (закрой все скобки) — лучше короче, но полностью, чем длиннее и оборвано.`;

  const { parsed, stopReason } = await callAnthropic(system, context, 4000);
  if (parsed) {
    if (stopReason === "max_tokens") parsed._truncated = true;
    return parsed;
  }
  console.error(`AI insights: core analysis JSON parse failed (stop_reason=${stopReason})`);
  return {
    summary: "Основной анализ не удалось разобрать. Нажмите «Обновить анализ», чтобы попробовать снова.",
    monthly_dynamics: "", quarterly_dynamics: "", yearly_dynamics: "", conversion_potential_analysis: "", navi_analysis: "",
    risks: [], short_term_recommendations: [], long_term_recommendations: [], _parse_error: true,
  };
}

/** Team breakdown + per-employee/business recommendations: a separate call (own token budget) so a large team never truncates the core analysis, and vice versa. */
async function callClaudeTeamAnalysis(context) {
  const teamContext = {
    label: context.label,
    per_mp: context.per_mp, per_rm: context.per_rm,
    conversion_summary: context.conversion_summary, potential_summary: context.potential_summary, navi_summary: context.navi_summary,
    months: context.months.slice(-6), quarterly: context.quarterly,
  };
  const peopleCount = (context.per_mp?.length || 0) + (context.per_rm?.length || 0);
  const briefRule = peopleCount > 10 ? "Команда большая — держи оценку и каждую рекомендацию по сотруднику в пределах 1-2 коротких предложений, без исключений." : "Оценка и рекомендации по сотруднику — 2-3 содержательных предложения.";
  const system = `Ты — HR-бизнес-партнёр и аналитик эффективности для фармацевтической команды в Узбекистане.
Тебе дают показатели эффективности по каждому сотруднику (медпредставителю${context.per_rm?.length ? " и региональному менеджеру" : ""}): последнее и среднее выполнение плана, вклад в конверсию/потенциал.
Дай оценку каждому сотруднику и рекомендации по развитию.
${briefRule}
${NO_DASH_RULE}
Отвечай СТРОГО в формате JSON (без markdown, без \`\`\`), на русском языке:
{
  "team_analysis": [ { "name": "имя сотрудника", "role": "МП или РМ", "assessment": "оценка эффективности и продуктивности, с цифрами" }, ... — один объект на каждого сотрудника из per_mp и per_rm, без пропусков ],
  "employee_recommendations": [ { "name": "имя сотрудника", "role": "МП или РМ", "monthly": "рекомендация на месяц", "quarterly": "рекомендация на квартал", "yearly": "рекомендация на год" }, ... — один объект на каждого сотрудника ],
  "business_recommendations": { "monthly": "общая рекомендация по бизнесу на месяц", "quarterly": "на квартал", "yearly": "на год" }
}
Обязательно включи ВСЕХ сотрудников из переданных данных, ни одного не пропускай. Обязательно заверши JSON полностью (закрой все скобки).`;

  const { parsed, stopReason } = await callAnthropic(system, teamContext, 8000);
  if (parsed) {
    if (stopReason === "max_tokens") parsed._team_truncated = true;
    return parsed;
  }
  console.error(`AI insights: team analysis JSON parse failed (stop_reason=${stopReason})`);
  return { team_analysis: [], employee_recommendations: [], business_recommendations: null, _team_parse_error: true };
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

module.exports = { aiEnabled, AI_MODEL, buildAnalyticsContext, callClaude, callClaudeTeamAnalysis, callClaudeForNavi };
