import { useTranslation } from 'react-i18next';
import { languageOptions } from '../../i18n';

export default function LanguageToggle() {
  const { i18n, t } = useTranslation();

  return (
    <div
      className="flex items-center rounded-full border border-white/10 bg-white/5 p-0.5"
      aria-label={t('language.switchLabel')}
      role="group"
    >
      {languageOptions.map((language) => {
        const isActive = i18n.resolvedLanguage === language.code || i18n.language === language.code;
        return (
          <button
            key={language.code}
            type="button"
            onClick={() => void i18n.changeLanguage(language.code)}
            className={`grid h-7 w-7 place-items-center rounded-full text-base transition active:scale-[0.94] ${
              isActive ? 'bg-white/15 ring-1 ring-white/20' : 'opacity-55 hover:opacity-90'
            }`}
            aria-label={language.label}
            aria-pressed={isActive}
            title={language.label}
          >
            <span aria-hidden="true">{language.flag}</span>
          </button>
        );
      })}
    </div>
  );
}
