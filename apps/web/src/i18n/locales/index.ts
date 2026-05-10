import en from './en';
import ja from './ja';
import zhHans from './zh-Hans';
import zhHant from './zh-Hant';

export const resources = {
  en,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja
} as const;

export type LocaleResources = typeof resources;
