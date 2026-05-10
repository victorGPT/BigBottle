import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ScanLine, Trophy, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

type Tab = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
};

const TABS: Tab[] = [
  { to: '/', labelKey: 'common.home', icon: LayoutDashboard, end: true },
  { to: '/rewards', labelKey: 'common.rewards', icon: Trophy },
  { to: '/account', labelKey: 'common.account', icon: User }
];

export default function BottomTabBar() {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-[420px] px-5">
        <div className="relative h-[100px]">
          <nav
            aria-label={t('nav.primary')}
            className="absolute left-1/2 bottom-4 flex h-[62px] w-[360px] -translate-x-1/2 items-center justify-around rounded-full border border-[#1E3A1E] bg-[#0A1F0A]/85 px-1 backdrop-blur"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const labelKey = tab.labelKey;
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    clsx(
                      'flex h-full flex-1 flex-col items-center justify-center gap-1 rounded-full px-2 py-2 text-center',
                      isActive ? 'text-[#4ADE80]' : 'text-[#666666]'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={20} className={isActive ? 'text-[#4ADE80]' : 'text-[#666666]'} />
                      <span className={clsx('text-[9px] leading-none', isActive ? 'font-semibold' : 'font-medium')}>
                        {t(labelKey)}
                      </span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <NavLink
            to="/scan"
            aria-label={t('common.scanReceipt')}
            className="absolute left-1/2 top-[-50px] flex h-16 w-16 -translate-x-1/2 items-center justify-center rounded-full border-4 border-white bg-[#4ADE80] text-white shadow-[0_12px_40px_rgba(74,222,128,0.25)] transition active:scale-[0.98]"
          >
            <ScanLine size={28} />
          </NavLink>
        </div>
      </div>
    </div>
  );
}
