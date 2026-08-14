import React, { useEffect, useState } from "react";
import Avatar from "../components/Avatar.jsx";
import { api } from "../api.js";
import MpProfile from "./MpProfile.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function TeamPage({ user }) {
  const { t } = useLanguage();
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
      <div className="font-display text-2xl font-semibold mb-1">{t("nav.myteam")}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("team.subtitle")}</div>

      {byGroup.map(({ group, mps: groupMps }) => groupMps.length > 0 && (
        <div key={group.id} className="mb-6">
          <div className="text-sm uppercase tracking-wide mb-2" style={{ color: "#ED3237" }}>{group.name}</div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {groupMps.map((mp) => (
              <button key={mp.id} onClick={() => setSelectedMp(mp)} className="text-left rounded-2xl p-4 flex items-center gap-3" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
                <Avatar userId={mp.id} name={mp.full_name} size={40} />
                <div>
                  <div className="font-semibold">{mp.full_name}</div>
                  <div className="text-xs mt-1" style={{ color: "#6B7280" }}>{mp.territory || "—"}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div className="mb-6">
          <div className="text-sm uppercase tracking-wide mb-2" style={{ color: "#6B7280" }}>{t("team.ungrouped")}</div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {ungrouped.map((mp) => (
              <button key={mp.id} onClick={() => setSelectedMp(mp)} className="text-left rounded-2xl p-4 flex items-center gap-3" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
                <Avatar userId={mp.id} name={mp.full_name} size={40} />
                <div>
                  <div className="font-semibold">{mp.full_name}</div>
                  <div className="text-xs mt-1" style={{ color: "#6B7280" }}>{mp.territory || "—"}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {mps.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("team.empty")}</div>}
    </div>
  );
}
