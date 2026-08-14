import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import Gauge from "../components/Gauge.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function achColor(pct) {
  if (pct === null || pct === undefined) return "#6B7280";
  if (pct >= 0.9) return "#16A34A";
  if (pct >= 0.8) return "#ED3237";
  return "#DC2626";
}

export default function Dashboard({ role }) {
  const { t } = useLanguage();
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => { api.dashboard().then(setData); }, []);

  if (!data) return <div className="max-w-6xl mx-auto px-5 py-10" style={{ color: "#6B7280" }}>{t("common.loading")}</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">{role === "master" ? t("dashboard.title_master") : t("dashboard.title_team")}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("dashboard.subtitle")}</div>

      <div className="rounded-2xl p-5 mb-6 flex flex-wrap items-center gap-6" style={{ background: "linear-gradient(90deg,#EEF1F8,#F7F8FC)", border: "1px solid #E4E7F0" }}>
        <Gauge achievement={data.company.achievement || 0} size={150} />
        <div className="flex-1 min-w-[220px] grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <div className="text-xs uppercase" style={{ color: "#6B7280" }}>{t("dashboard.plan_fact")}</div>
            <div className="font-mono text-lg">${data.company.actual_usd.toLocaleString()} / ${data.company.target_usd.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs uppercase" style={{ color: "#6B7280" }}>{t("dashboard.bonus_sum")}</div>
            <div className="font-mono text-lg" style={{ color: "#ED3237" }}>{data.company.bonus_uzs.toLocaleString()} UZS</div>
          </div>
          <div>
            <div className="text-xs uppercase" style={{ color: "#6B7280" }}>{role === "master" ? t("dashboard.regions") : t("common.territory")}</div>
            <div className="font-mono text-lg">{data.hierarchy.length}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {data.hierarchy.map((rm) => (
          <div key={rm.id} className="rounded-2xl overflow-hidden" style={{ border: "1px solid #E4E7F0" }}>
            <button onClick={() => setExpanded((e) => ({ ...e, [rm.id]: !e[rm.id] }))}
              className="w-full flex flex-wrap items-center justify-between gap-3 p-4 text-left" style={{ background: "#F7F8FC" }}>
              <div>
                <div className="font-semibold">{rm.name}</div>
                <div className="text-xs" style={{ color: "#6B7280" }}>{rm.mps.length} {t("dashboard.mp_short")}</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="font-mono text-sm" style={{ color: "#6B7280" }}>${rm.actual_usd.toLocaleString()} / ${rm.target_usd.toLocaleString()}</div>
                <div className="font-mono font-bold" style={{ color: achColor(rm.achievement) }}>{rm.achievement !== null ? `${(rm.achievement * 100).toFixed(1)}%` : "—"}</div>
                <span style={{ color: "#6B7280" }}>{expanded[rm.id] ? "▲" : "▼"}</span>
              </div>
            </button>
            {expanded[rm.id] && (
              <div className="divide-y" style={{ borderColor: "#E4E7F0" }}>
                {rm.mps.map((mp) => (
                  <div key={mp.id} className="flex flex-wrap items-center justify-between gap-3 p-3 px-4" style={{ background: "#FFFFFF" }}>
                    <div>
                      <div className="text-sm">{mp.name}</div>
                      <div className="text-xs" style={{ color: "#6B7280" }}>{mp.territory || "—"} {mp.latest_period ? `· ${mp.latest_period}` : `· ${t("dashboard.no_approved")}`}</div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-mono" style={{ color: "#6B7280" }}>${mp.actual_usd.toLocaleString()} / ${mp.target_usd.toLocaleString()}</span>
                      <span className="font-mono font-semibold" style={{ color: achColor(mp.achievement) }}>{mp.achievement !== null ? `${(mp.achievement * 100).toFixed(1)}%` : "—"}</span>
                      <span className="font-mono" style={{ color: "#ED3237" }}>{mp.bonus_uzs.toLocaleString()} UZS</span>
                    </div>
                  </div>
                ))}
                {rm.mps.length === 0 && <div className="p-3 px-4 text-sm" style={{ color: "#6B7280" }}>{t("dashboard.no_mps")}</div>}
              </div>
            )}
          </div>
        ))}
        {data.hierarchy.length === 0 && <div className="text-sm" style={{ color: "#6B7280" }}>{t("dashboard.no_data")}</div>}
      </div>
    </div>
  );
}
