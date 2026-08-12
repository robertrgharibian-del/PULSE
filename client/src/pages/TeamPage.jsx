import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import MpProfile from "./MpProfile.jsx";

export default function TeamPage({ user }) {
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedMp, setSelectedMp] = useState(null);

  useEffect(() => {
    api.listUsers().then(setUsers);
    api.listGroups().then(setGroups);
  }, []);

  if (selectedMp) return <MpProfile mpId={selectedMp.id} mpName={selectedMp.full_name} onBack={() => setSelectedMp(null)} />;

  const mps = users.filter((u) => u.role === "mp");
  const byGroup = groups.map((g) => ({ group: g, mps: mps.filter((m) => m.group_id === g.id) }));
  const ungrouped = mps.filter((m) => !m.group_id);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">Моя команда</div>
      <div className="text-sm mb-6" style={{ color: "#8493AA" }}>Карточки сотрудников, история, план развития</div>

      {byGroup.map(({ group, mps: groupMps }) => groupMps.length > 0 && (
        <div key={group.id} className="mb-6">
          <div className="text-sm uppercase tracking-wide mb-2" style={{ color: "#E8B04B" }}>{group.name}</div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {groupMps.map((mp) => (
              <button key={mp.id} onClick={() => setSelectedMp(mp)} className="text-left rounded-2xl p-4" style={{ background: "#141F33", border: "1px solid #22304A" }}>
                <div className="font-semibold">{mp.full_name}</div>
                <div className="text-xs mt-1" style={{ color: "#8493AA" }}>{mp.territory || "—"}</div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div className="mb-6">
          <div className="text-sm uppercase tracking-wide mb-2" style={{ color: "#8493AA" }}>Без группы</div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {ungrouped.map((mp) => (
              <button key={mp.id} onClick={() => setSelectedMp(mp)} className="text-left rounded-2xl p-4" style={{ background: "#141F33", border: "1px solid #22304A" }}>
                <div className="font-semibold">{mp.full_name}</div>
                <div className="text-xs mt-1" style={{ color: "#8493AA" }}>{mp.territory || "—"}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {mps.length === 0 && <div className="text-sm" style={{ color: "#8493AA" }}>В команде пока нет медпредов</div>}
    </div>
  );
}
