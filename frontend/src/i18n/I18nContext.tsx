import React, { createContext, useContext, useState, useEffect } from 'react';
import zh from './locales/zh.json';
import en from './locales/en.json';

type Translations = typeof zh;
type Language = 'zh' | 'en';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const translations: Record<Language, Translations> = { zh, en };

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider: React.FC<{ children: React.ReactNode, initialLanguage?: Language }> = ({ children, initialLanguage = 'zh' }) => {
  const [language, setLangState] = useState<Language>(initialLanguage);

  const t = (path: string, params?: Record<string, string | number>): string => {
    const keys = path.split('.');
    let result: any = translations[language];
    for (const key of keys) {
      if (result && result[key]) {
        result = result[key];
      } else {
        return path; // Fallback to path if not found
      }
    }
    
    let text = typeof result === 'string' ? result : path;
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        text = text.replace(new RegExp(`{${key}}`, 'g'), String(value));
      });
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage: setLangState, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider');
  }
  return context;
};
