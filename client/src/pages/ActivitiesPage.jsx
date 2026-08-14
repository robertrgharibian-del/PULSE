import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function TypeManager({ category, user, onChanged }) {
  const { t, lang } = useLanguage();
  const [types, setTypes] = useState([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameUz, setNameUz] = useState("");
  const [monthlyTarget, setMonthlyTarget] = useState("");
  const [quarterlyTarget, setQuarterlyTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setTypes(await api.listActivityTypes(category));
  }
  useEffect(() => { load(); }, [category]);

  async function submit() {
    if (!name.trim()) { setError(t("activities.err_name")); return; }
    setBusy(true); setError("");
    try {
      await api.createActivityType({ category, name: name.trim(), name_uz: nameUz.trim(), monthly_target: Number(monthlyTarget) || 0, quarterly_target: Number(quarterlyTarget) || 0 });
      setName(""); setNameUz(""); setMonthlyTarget(""); setQuarterlyTarget("");
      setOpen(false);
      await load();
      onChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(id) {
    if (!confirm(t("activities.confirm_delete_type"))) return;
    try { await api.deleteActivityType(id); await load(); onChanged?.(); } catch (e) { setError(e.message); }
  }

  const canManage = user.role === "master" || user.role === "bm";

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">{t("activities.types_title")}</div>
      <div className="space-y-2 mb-4">
        {types.map((tp) => (
          <div key={tp.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#EEF1F8" }}>
            <div>
              <span className="font-semibold">{lang === "uz" && tp.name_uz ? tp.name_uz : tp.name}</span>
              <span style={{ color: "#6B7280" }}> · {tp.group_name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs" style={{ color: "#ED3237" }}>{t("activities.per_month")}: {tp.monthly_target} · {t("activities.per_quarter")}: {tp.quarterly_target}</span>
              {canManage && <button onClick={() => remove(tp.id)} className="text-xs" style={{ color: "#DC2626" }}>{t("common.delete")}</button>}
            </div>
          </div>
        ))}
        {types.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("activities.no_types")}</div>}
      </div>

      {canManage && (
        open ? (
          <div className="rounded-xl p-3" style={{ background: "#EEF1F8" }}>
            <div className="grid sm:grid-cols-2 gap-2 mb-2">
              <input placeholder={t("activities.name_ru")} value={name} onChange={(e) => setName(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <input placeholder={t("activities.name_uz")} value={nameUz} onChange={(e) => setNameUz(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }} />
              <input type="number" placeholder={t("activities.per_month")} value={monthlyTarget} onChange={(e) => setMonthlyTarget(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm font-mono" style={{ borderColor: "#D3D8E4" }} />
              <input type="number" placeholder={t("activities.per_quarter")} value={quarterlyTarget} onChange={(e) => setQuarterlyTarget(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 text-sm font-mono" style={{ borderColor: "#D3D8E4" }} />
            </div>
            {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
            <div className="flex gap-2">
              <button onClick={submit} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.save")}</button>
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>{t("common.cancel")}</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ {t("activities.add_type")}</button>
        )
      )}
    </div>
  );
}

function EntryForm({ category, types, onChanged }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [date, setDate] = useState("");
  const [city, setCity] = useState("");
  const [venue, setVenue] = useState("");
  const [participants, setParticipants] = useState("");
  const [participantNames, setParticipantNames] = useState("");
  const [comments, setComments] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!typeId || !date) { setError(t("activities.err_type_date")); return; }
    setBusy(true); setError("");
    try {
      await api.createActivityEntry({
        activity_type_id: typeId, planned_date: date, city, venue: category === "event" ? venue : undefined,
        participants_count: category === "activity" ? Number(participants) || null : null,
        participant_names: category === "activity" ? participantNames : null, comments,
      });
      setTypeId(""); setDate(""); setCity(""); setVenue(""); setParticipants(""); setParticipantNames(""); setComments("");
      setOpen(false);
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="px-5 py-2.5 rounded font-semibold mb-6" style={{ background: "#ED3237", color: "#FFFFFF" }}>+ {t("activities.add_plan")}</button>;

  return (
    <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <div className="font-display text-lg mb-3">{t("activities.new_plan")}</div>
      <div className="grid sm:grid-cols-2 gap-2 mb-3 text-sm">
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
          <option value="" style={{ color: "#000" }}>{t("activities.select_type")}</option>
          {types.map((tp) => <option key={tp.id} value={tp.id} style={{ color: "#000" }}>{tp.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        <input placeholder={t("doctracking.city")} value={city} onChange={(e) => setCity(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        {category === "event" ? (
          <input placeholder={t("activities.venue")} value={venue} onChange={(e) => setVenue(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
        ) : (
          <input type="number" placeholder={t("activities.participants_count")} value={participants} onChange={(e) => setParticipants(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 font-mono" style={{ borderColor: "#D3D8E4" }} />
        )}
        {category === "activity" && (
          <textarea rows={2} placeholder={t("activities.participant_names")} value={participantNames} onChange={(e) => setParticipantNames(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-2" style={{ borderColor: "#D3D8E4" }} />
        )}
        <textarea rows={2} placeholder={t("common.comments")} value={comments} onChange={(e) => setComments(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-2" style={{ borderColor: "#D3D8E4" }} />
      </div>
      {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("common.save")}</button>
        <button onClick={() => setOpen(false)} className="px-4 py-2 rounded text-sm" style={{ background: "#E4E7F0" }}>{t("common.cancel")}</button>
      </div>
    </div>
  );
}

function EntryRow({ entry, category, user, onChanged }) {
  const { t, lang } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [actualDate, setActualDate] = useState(entry.actual_date ? String(entry.actual_date).slice(0, 10) : entry.planned_date ? String(entry.planned_date).slice(0, 10) : "");
  const [actualParticipants, setActualParticipants] = useState(entry.actual_participants_count ?? "");
  const [actualParticipantNames, setActualParticipantNames] = useState(entry.actual_participant_names || "");
  const [actualComments, setActualComments] = useState(entry.actual_comments || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canEdit = user.role === "mp" && user.id === entry.mp_id;
  const typeName = lang === "uz" && entry.type_name_uz ? entry.type_name_uz : entry.type_name;

  async function complete() {
    setBusy(true); setError("");
    try {
      await api.updateActivityEntry(entry.id, {
        actual_date: actualDate, actual_participants_count: category === "activity" ? Number(actualParticipants) || null : null,
        actual_participant_names: category === "activity" ? actualParticipantNames : null, actual_comments: actualComments, status: "completed",
      });
      setEditing(false);
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(t("common.confirm_delete"))) return;
    try { await api.deleteActivityEntry(entry.id); onChanged(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="rounded-xl p-3 mb-2" style={{ background: "#EEF1F8" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold">{typeName}</span>
          <span style={{ color: "#6B7280" }}> · {user.role !== "mp" && `${entry.mp_name} · `}{entry.city || "—"} · {String(entry.planned_date).slice(0, 10)}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: entry.status === "completed" ? "#16A34A22" : "#ED323722", color: entry.status === "completed" ? "#16A34A" : "#ED3237" }}>
            {entry.status === "completed" ? t("activities.status_completed") : t("activities.status_planned")}
          </span>
          {canEdit && entry.status === "planned" && <button onClick={() => setEditing((v) => !v)} className="text-xs" style={{ color: "#ED3237" }}>{t("activities.report_result")}</button>}
          {canEdit && entry.status === "planned" && <button onClick={remove} className="text-xs" style={{ color: "#DC2626" }}>{t("common.delete")}</button>}
        </div>
      </div>
      {entry.comments && <div className="text-xs mt-1" style={{ color: "#6B7280" }}>{entry.comments}</div>}
      {entry.status === "completed" && entry.actual_comments && (
        <div className="text-xs mt-1" style={{ color: "#16A34A" }}>{t("common.comments")}: {entry.actual_comments}</div>
      )}
      {editing && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "#D3D8E4" }}>
          <div className="grid sm:grid-cols-2 gap-2 mb-2 text-sm">
            <input type="date" value={actualDate} onChange={(e) => setActualDate(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }} />
            {category === "activity" && (
              <input type="number" placeholder={t("activities.participants_count")} value={actualParticipants} onChange={(e) => setActualParticipants(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 font-mono" style={{ borderColor: "#D3D8E4" }} />
            )}
            {category === "activity" && (
              <textarea rows={2} placeholder={t("activities.participant_names")} value={actualParticipantNames} onChange={(e) => setActualParticipantNames(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-2" style={{ borderColor: "#D3D8E4" }} />
            )}
            <textarea rows={2} placeholder={t("common.comments")} value={actualComments} onChange={(e) => setActualComments(e.target.value)} className="bg-transparent border rounded px-2 py-1.5 sm:col-span-2" style={{ borderColor: "#D3D8E4" }} />
          </div>
          {error && <div className="text-xs mb-2" style={{ color: "#DC2626" }}>{error}</div>}
          <button onClick={complete} disabled={busy} className="px-4 py-2 rounded text-sm font-semibold" style={{ background: "#16A34A", color: "#FFFFFF" }}>{t("activities.mark_completed")}</button>
        </div>
      )}
    </div>
  );
}

export default function ActivitiesPage({ user, category }) {
  const { t, lang } = useLanguage();
  const [types, setTypes] = useState([]);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [report, setReport] = useState(null);

  async function load() {
    setLoading(true);
    const [ty, en, rep] = await Promise.all([
      api.listActivityTypes(category),
      api.listActivityEntries({ category, year, month }),
      api.activityReport({ year, month }),
    ]);
    setTypes(ty); setEntries(en); setReport(rep);
    setLoading(false);
  }
  useEffect(() => { load(); }, [category, year, month]);

  const title = category === "event" ? t("nav.events") : t("nav.activities");

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">{title}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("activities.subtitle")}</div>

      <TypeManager category={category} user={user} onChanged={load} />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="bg-transparent border rounded px-2 py-1.5 text-sm" style={{ borderColor: "#D3D8E4" }}>
          {(lang === "uz"
            ? ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"]
            : ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
          ).map((m, i) => <option key={m} value={i + 1} style={{ color: "#000" }}>{m}</option>)}
        </select>
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="bg-transparent border rounded px-2 py-1.5 text-sm w-24 font-mono" style={{ borderColor: "#D3D8E4" }} />
      </div>

      {report && report.summary.length > 0 && (
        <div className="rounded-2xl p-4 sm:p-5 mb-6" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
          <div className="font-display text-lg mb-3">{t("activities.monthly_report")}</div>
          <div className="space-y-2">
            {report.summary.filter((s) => s.category === category).map((s, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "#EEF1F8" }}>
                <div>{lang === "uz" && s.type_name_uz ? s.type_name_uz : s.type_name}</div>
                <div className="flex items-center gap-3 font-mono text-xs">
                  <span style={{ color: "#6B7280" }}>{t("activities.completed_of_planned", { c: s.completed, p: s.planned })}</span>
                  <span style={{ color: s.achievement >= 1 ? "#16A34A" : "#ED3237" }}>{s.achievement != null ? `${(s.achievement * 100).toFixed(0)}%` : "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {user.role === "mp" && <EntryForm category={category} types={types} onChanged={load} />}

      {loading ? <div style={{ color: "#6B7280" }}>{t("common.loading")}</div> : (
        <div>
          {entries.map((e) => <EntryRow key={e.id} entry={e} category={category} user={user} onChanged={load} />)}
          {entries.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("activities.no_entries")}</div>}
        </div>
      )}
    </div>
  );
}
