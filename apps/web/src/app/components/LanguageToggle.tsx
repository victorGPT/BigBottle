import { useTranslation } from 'react-i18next';

export default function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const nextLanguage = i18n.language === 'zh' ? 'en' : 'zh';

  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(nextLanguage)}
      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-white/70 transition active:scale-[0.99]"
      aria-label={t('language.switchLabel')}
    >
      {nextLanguage === 'zh' ? t('language.chinese') : t('language.english')}
    </button>
  );
}
