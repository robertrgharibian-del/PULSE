import React, { useState } from "react";
import { VISIT_TYPES, CONSTRUCTOR_RULES } from "../data/visitTypes.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function TechniqueCard({ tech, expanded, onToggle, t }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
      <button onClick={onToggle} className="w-full text-left p-4 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold" style={{ color: "#3E4095" }}>{tech.name}</div>
          <div className="text-sm mt-1" style={{ color: "#6B7280" }}>{tech.short}</div>
        </div>
        <span style={{ color: "#6B7280" }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 text-sm space-y-3">
          <div>
            <div className="text-xs uppercase font-semibold mb-1" style={{ color: "#ED3237" }}>{t("help.when_use")}</div>
            <div>{tech.when}</div>
          </div>
          <div>
            <div className="text-xs uppercase font-semibold mb-1" style={{ color: "#ED3237" }}>{t("help.how_use")}</div>
            <ol className="list-decimal ml-4 space-y-1">
              {tech.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs uppercase font-semibold mb-1" style={{ color: "#16A34A" }}>{t("help.pros")}</div>
              <ul className="list-disc ml-4 space-y-1">{tech.pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs uppercase font-semibold mb-1" style={{ color: "#DC2626" }}>{t("help.cons")}</div>
              <ul className="list-disc ml-4 space-y-1">{tech.cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "#EEF1F8" }}>
            <div className="text-xs uppercase font-semibold mb-1" style={{ color: "#6B7280" }}>{t("help.example")}</div>
            <div className="italic">{tech.example}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function Constructor({ t, lang, techniques }) {
  const [experience, setExperience] = useState("");
  const [psychotype, setPsychotype] = useState("");
  const [potential, setPotential] = useState("");
  const [needs, setNeeds] = useState("");
  const [result, setResult] = useState(null);

  function run() {
    const answers = { experience, psychotype, potential, needs };
    const rule = CONSTRUCTOR_RULES.find((r) => r.match(answers)) || CONSTRUCTOR_RULES[CONSTRUCTOR_RULES.length - 1];
    setResult(rule);
  }

  const opt = (v, label) => <option key={v} value={v} style={{ color: "#000" }}>{label}</option>;

  return (
    <div>
      <div className="rounded-2xl p-4 sm:p-5 mb-4" style={{ background: "#F7F8FC", border: "1px solid #E4E7F0" }}>
        <div className="grid sm:grid-cols-2 gap-3 text-sm mb-4">
          <label className="flex flex-col gap-1">
            <span style={{ color: "#6B7280" }}>{t("help.q_experience")}</span>
            <select value={experience} onChange={(e) => setExperience(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>—</option>
              {opt("junior", t("help.exp_junior"))}
              {opt("mid", t("help.exp_mid"))}
              {opt("veteran", t("help.exp_veteran"))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ color: "#6B7280" }}>{t("help.q_psychotype")}</span>
            <select value={psychotype} onChange={(e) => setPsychotype(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>—</option>
              {opt("dominant", t("help.psy_dominant"))}
              {opt("expressive", t("help.psy_expressive"))}
              {opt("amiable", t("help.psy_amiable"))}
              {opt("analytical", t("help.psy_analytical"))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ color: "#6B7280" }}>{t("help.q_potential")}</span>
            <select value={potential} onChange={(e) => setPotential(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>—</option>
              {opt("low", t("help.pot_low"))}
              {opt("medium", t("help.pot_medium"))}
              {opt("high", t("help.pot_high"))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span style={{ color: "#6B7280" }}>{t("help.q_needs")}</span>
            <select value={needs} onChange={(e) => setNeeds(e.target.value)} className="bg-transparent border rounded px-2 py-1.5" style={{ borderColor: "#D3D8E4" }}>
              <option value="" style={{ color: "#000" }}>—</option>
              {opt("problem", t("help.needs_problem"))}
              {opt("relationship", t("help.needs_relationship"))}
              {opt("data", t("help.needs_data"))}
              {opt("unknown", t("help.needs_unknown"))}
            </select>
          </label>
        </div>
        <button onClick={run} className="px-5 py-2.5 rounded font-semibold" style={{ background: "#ED3237", color: "#FFFFFF" }}>{t("help.get_recommendation")}</button>
      </div>

      {result && (
        <div className="rounded-2xl p-4 sm:p-5" style={{ background: "linear-gradient(135deg,#EEF1F8,#F7F8FC)", border: "1px solid #E4E7F0" }}>
          <div className="text-sm mb-3" style={{ color: "#6B7280" }}>{result.reason[lang] || result.reason.ru}</div>
          <div className="flex flex-wrap gap-3">
            {result.keys.map((k) => {
              const tech = techniques.find((x) => x.key === k);
              if (!tech) return null;
              return (
                <div key={k} className="rounded-xl p-3 flex-1 min-w-[200px]" style={{ background: "#FFFFFF", border: "1px solid #E4E7F0" }}>
                  <div className="font-semibold" style={{ color: "#3E4095" }}>{tech.name}</div>
                  <div className="text-xs mt-1" style={{ color: "#6B7280" }}>{tech.short}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const { t, lang } = useLanguage();
  const [subTab, setSubTab] = useState("library");
  const [expandedKey, setExpandedKey] = useState(null);
  const techniques = VISIT_TYPES[lang] || VISIT_TYPES.ru;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-5 py-8">
      <div className="font-display text-2xl font-semibold mb-1">{t("nav.help")}</div>
      <div className="text-sm mb-6" style={{ color: "#6B7280" }}>{t("help.subtitle")}</div>

      <div className="flex gap-2 mb-5">
        {[["library", t("help.tab_library")], ["constructor", t("help.tab_constructor")]].map(([k, label]) => (
          <button key={k} onClick={() => setSubTab(k)} className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: subTab === k ? "#ED3237" : "#F7F8FC", color: subTab === k ? "#FFFFFF" : "#1F2937", border: "1px solid #E4E7F0" }}>
            {label}
          </button>
        ))}
      </div>

      {subTab === "library" && (
        <div className="space-y-3">
          {techniques.map((tech) => (
            <TechniqueCard key={tech.key} tech={tech} t={t} expanded={expandedKey === tech.key} onToggle={() => setExpandedKey((k) => k === tech.key ? null : tech.key)} />
          ))}
        </div>
      )}

      {subTab === "constructor" && <Constructor t={t} lang={lang} techniques={techniques} />}
    </div>
  );
}
