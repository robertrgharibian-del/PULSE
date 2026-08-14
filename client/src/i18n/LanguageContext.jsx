import React, { createContext, useContext, useState, useCallback } from "react";
import { translations } from "./translations.js";

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => localStorage.getItem("pulse_lang") || "ru");

  const setLang = useCallback((l) => {
    setLangState(l);
    localStorage.setItem("pulse_lang", l);
  }, []);

  const t = useCallback((key, params) => {
    let str = translations[lang]?.[key] ?? translations.ru?.[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) str = str.replaceAll(`{{${k}}}`, v);
    }
    return str;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
