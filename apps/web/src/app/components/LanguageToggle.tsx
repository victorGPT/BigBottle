import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageOptions } from '../../i18n';

export default function LanguageToggle() {
  const { i18n, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const currentLanguage = useMemo(() => {
    const language = languageOptions.find((option) => (
      option.code === i18n.resolvedLanguage || option.code === i18n.language
    ));
    return language ?? languageOptions[0];
  }, [i18n.language, i18n.resolvedLanguage]);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/5 text-base transition hover:bg-white/10 active:scale-[0.94]"
        aria-label={`${t('language.switchLabel')}: ${currentLanguage.label}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={currentLanguage.label}
      >
        <span aria-hidden="true">{currentLanguage.flag}</span>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-10 z-50 w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#102510]/95 py-1 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur"
          role="menu"
          aria-label={t('language.switchLabel')}
        >
          {languageOptions.map((language) => {
            const isActive = language.code === currentLanguage.code;
            return (
              <button
                key={language.code}
                type="button"
                onClick={() => {
                  void i18n.changeLanguage(language.code);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition ${
                  isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
                role="menuitemradio"
                aria-checked={isActive}
              >
                <span className="text-base" aria-hidden="true">{language.flag}</span>
                <span className="font-medium">{language.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
