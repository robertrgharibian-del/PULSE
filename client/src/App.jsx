import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { useLanguage } from "./i18n/LanguageContext.jsx";
import Login from "./pages/Login.jsx";
import MpPanel from "./pages/MpPanel.jsx";
import RmPanel from "./pages/RmPanel.jsx";
import TeamPage from "./pages/TeamPage.jsx";
import MasterReports from "./pages/MasterReports.jsx";
import MasterUsers from "./pages/MasterUsers.jsx";
import MasterImports from "./pages/MasterImports.jsx";
import AllComments from "./pages/AllComments.jsx";
import AiInsights from "./pages/AiInsights.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Profile from "./pages/Profile.jsx";
import BmReports from "./pages/BmReports.jsx";
import DocTrackingList from "./pages/DocTrackingList.jsx";
import PortfolioList from "./pages/PortfolioList.jsx";
import ActivitiesPage from "./pages/ActivitiesPage.jsx";
import NaviList from "./pages/NaviList.jsx";
import HelpPage from "./pages/HelpPage.jsx";
import RmBonusView from "./components/RmBonusView.jsx";
import Avatar from "./components/Avatar.jsx";

const NAV = {
  master: [["reports", "nav.reports"], ["users", "nav.users"], ["imports", "nav.imports"], ["comments", "nav.comments"], ["dashboard", "nav.dashboard"], ["myteam", "nav.myteam"], ["doctracking", "nav.doctracking"], ["portfolio", "nav.portfolio"], ["events", "nav.events"], ["activities", "nav.activities"], ["navi", "nav.navi"], ["help", "nav.help"], ["ai", "nav.ai"], ["profile", "nav.profile"]],
  rm: [["team", "nav.team"], ["myteam", "nav.myteam"], ["bonus", "nav.bonus"], ["dashboard", "nav.dashboard"], ["doctracking", "nav.doctracking"], ["portfolio", "nav.portfolio"], ["events", "nav.events"], ["activities", "nav.activities"], ["navi", "nav.navi"], ["help", "nav.help"], ["ai", "nav.ai"], ["profile", "nav.profile"]],
  mp: [["report", "nav.myreport"], ["doctracking", "nav.doctracking"], ["portfolio", "nav.portfolio"], ["events", "nav.events"], ["activities", "nav.activities"], ["navi", "nav.navi"], ["help", "nav.help"], ["ai", "nav.ai"], ["profile", "nav.profile"]],
  bm: [["reports", "nav.reports"], ["dashboard", "nav.dashboard"], ["myteam", "nav.myteam"], ["doctracking", "nav.doctracking"], ["portfolio", "nav.portfolio"], ["events", "nav.events"], ["activities", "nav.activities"], ["navi", "nav.navi"], ["help", "nav.help"], ["ai", "nav.ai"], ["profile", "nav.profile"]],
};
const DEFAULT_SECTION = { master: "reports", rm: "team", mp: "report", bm: "reports" };

function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  return (
    <div className="flex rounded-lg overflow-hidden text-xs font-semibold" style={{ border: "1px solid rgba(255,255,255,0.3)" }}>
      <button onClick={() => setLang("ru")} className="px-2.5 py-1.5" style={{ background: lang === "ru" ? "#ED3237" : "transparent", color: "#FFFFFF" }}>RU</button>
      <button onClick={() => setLang("uz")} className="px-2.5 py-1.5" style={{ background: lang === "uz" ? "#ED3237" : "transparent", color: "#FFFFFF" }}>UZ</button>
    </div>
  );
}

export default function App() {
  const { t } = useLanguage();
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [section, setSection] = useState("reports");

  useEffect(() => {
    const token = localStorage.getItem("fss_token");
    if (!token) { setChecking(false); return; }
    api.me().then((u) => { setUser(u); setSection(DEFAULT_SECTION[u.role]); })
      .catch(() => localStorage.removeItem("fss_token"))
      .finally(() => setChecking(false));
  }, []);

  function handleLogin(u) {
    setUser(u);
    setSection(DEFAULT_SECTION[u.role]);
  }
  function logout() {
    localStorage.removeItem("fss_token");
    setUser(null);
  }

  if (checking) return <div style={{ background: "#FFFFFF", minHeight: "100vh" }} />;
  if (!user) return <div style={{ background: "#FFFFFF", minHeight: "100vh" }}><Login onLogin={handleLogin} /></div>;

  const nav = NAV[user.role] || [];
  const NAVY = "#3E4095";

  return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh" }}>
      <div style={{ background: NAVY }}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg px-3 py-2" style={{ background: "#FFFFFF" }}>
              <img src="/pulse-logo.png" alt="PULSE" className="h-14 sm:h-20" style={{ width: "auto", display: "block" }} />
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm">
            <LanguageSwitcher />
            <span className="hidden sm:flex items-center gap-2" style={{ color: "#C7CBEA" }}>
              <Avatar userId={user.id} name={user.full_name} size={28} />
              {user.full_name} · {t(`role.${user.role}`)}{user.group_name ? ` · ${user.group_name}` : ""}
            </span>
            <button onClick={logout} className="px-3 py-1.5 rounded" style={{ background: "rgba(255,255,255,0.15)", color: "#FFFFFF" }}>{t("app.logout")}</button>
          </div>
        </div>
        {nav.length > 1 && (
          <div className="flex gap-1 px-4 sm:px-6 pb-2 overflow-x-auto">
            {nav.map(([key, labelKey]) => (
              <button key={key} onClick={() => setSection(key)}
                className="px-3 sm:px-4 py-1.5 rounded-lg text-sm font-medium shrink-0"
                style={{ background: section === key ? "#ED3237" : "transparent", color: section === key ? "#FFFFFF" : "#C7CBEA" }}>
                {t(labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {user.role === "master" && section === "reports" && <MasterReports user={user} />}
      {user.role === "master" && section === "users" && <MasterUsers />}
      {user.role === "master" && section === "imports" && <MasterImports />}
      {user.role === "master" && section === "comments" && <AllComments />}
      {user.role === "master" && section === "dashboard" && <Dashboard role="master" />}
      {user.role === "master" && section === "myteam" && <TeamPage user={user} />}
      {user.role === "master" && section === "doctracking" && <DocTrackingList user={user} />}
      {user.role === "master" && section === "portfolio" && <PortfolioList user={user} />}
      {user.role === "master" && section === "events" && <ActivitiesPage user={user} category="event" />}
      {user.role === "master" && section === "activities" && <ActivitiesPage user={user} category="activity" />}
      {user.role === "master" && section === "navi" && <NaviList user={user} />}
      {user.role === "master" && section === "help" && <HelpPage />}
      {user.role === "master" && section === "ai" && <AiInsights />}
      {user.role === "master" && section === "profile" && <Profile user={user} onUpdated={setUser} />}

      {user.role === "rm" && section === "team" && <RmPanel user={user} />}
      {user.role === "rm" && section === "myteam" && <TeamPage user={user} />}
      {user.role === "rm" && section === "bonus" && <RmBonusView rmId={user.id} rmName={null} />}
      {user.role === "rm" && section === "dashboard" && <Dashboard role="rm" />}
      {user.role === "rm" && section === "doctracking" && <DocTrackingList user={user} />}
      {user.role === "rm" && section === "portfolio" && <PortfolioList user={user} />}
      {user.role === "rm" && section === "events" && <ActivitiesPage user={user} category="event" />}
      {user.role === "rm" && section === "activities" && <ActivitiesPage user={user} category="activity" />}
      {user.role === "rm" && section === "navi" && <NaviList user={user} />}
      {user.role === "rm" && section === "help" && <HelpPage />}
      {user.role === "rm" && section === "ai" && <AiInsights />}
      {user.role === "rm" && section === "profile" && <Profile user={user} onUpdated={setUser} />}

      {user.role === "mp" && section === "report" && <MpPanel user={user} />}
      {user.role === "mp" && section === "doctracking" && <DocTrackingList user={user} />}
      {user.role === "mp" && section === "portfolio" && <PortfolioList user={user} />}
      {user.role === "mp" && section === "events" && <ActivitiesPage user={user} category="event" />}
      {user.role === "mp" && section === "activities" && <ActivitiesPage user={user} category="activity" />}
      {user.role === "mp" && section === "navi" && <NaviList user={user} />}
      {user.role === "mp" && section === "help" && <HelpPage />}
      {user.role === "mp" && section === "ai" && <AiInsights />}
      {user.role === "mp" && section === "profile" && <Profile user={user} onUpdated={setUser} />}

      {user.role === "bm" && section === "reports" && <BmReports user={user} />}
      {user.role === "bm" && section === "dashboard" && <Dashboard role="bm" />}
      {user.role === "bm" && section === "myteam" && <TeamPage user={user} />}
      {user.role === "bm" && section === "doctracking" && <DocTrackingList user={user} />}
      {user.role === "bm" && section === "portfolio" && <PortfolioList user={user} />}
      {user.role === "bm" && section === "events" && <ActivitiesPage user={user} category="event" />}
      {user.role === "bm" && section === "activities" && <ActivitiesPage user={user} category="activity" />}
      {user.role === "bm" && section === "navi" && <NaviList user={user} />}
      {user.role === "bm" && section === "help" && <HelpPage />}
      {user.role === "bm" && section === "ai" && <AiInsights />}
      {user.role === "bm" && section === "profile" && <Profile user={user} onUpdated={setUser} />}
    </div>
  );
}
