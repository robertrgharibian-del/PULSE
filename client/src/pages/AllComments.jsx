import React, { useEffect, useState } from "react";
import { monthName } from "../api.js";
import Avatar from "../components/Avatar.jsx";
import { api } from "../api.js";

export default function AllComments() {
  const [comments, setComments] = useState(null);
  const [filter, setFilter] = useState("");

  useEffect(() => { api.allComments().then(setComments); }, []);

  const filtered = comments?.filter((c) =>
    !filter || c.mp_name?.toLowerCase().includes(filter.toLowerCase()) || c.rm_name?.toLowerCase().includes(filter.toLowerCase()) || c.author_name?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">Все переписки</div>
      <div className="text-sm mb-5" style={{ color: "#6B7280" }}>Комментарии всех РМ и мастера по всем отчётам всех медпредов</div>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Фильтр по имени МП / РМ / автора…"
        className="w-full bg-transparent border rounded px-3 py-2 text-sm mb-5" style={{ borderColor: "#D3D8E4" }} />

      {!comments ? <div style={{ color: "#6B7280" }}>Загрузка…</div> : (
        <div className="space-y-2">
          {filtered.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>Ничего не найдено</div>}
          {filtered.map((c) => (
            <div key={c.id} className="rounded-xl p-3" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="text-sm flex items-center gap-2">
                  <Avatar userId={c.author_id} name={c.author_name} size={24} />
                  <span style={{ color: "#ED3237" }} className="font-semibold">{c.author_name}</span>
                  <span style={{ color: "#6B7280" }}> ({c.author_role === "rm" ? "РМ" : c.author_role === "master" ? "Мастер" : "МП"})</span>
                </div>
                <div className="text-xs" style={{ color: "#6B7280" }}>{new Date(c.created_at).toLocaleString("ru-RU")}</div>
              </div>
              <div className="text-sm mb-1">{c.comment_text}</div>
              <div className="text-xs" style={{ color: "#6B7280" }}>
                {c.mp_name} ({c.rm_name || "—"}) · {monthName(c.period_month)} {c.period_year} · раздел: {c.section}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
