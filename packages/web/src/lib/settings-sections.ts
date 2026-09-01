export const SECTION_IDS = [
  'appearance',
  'account',
  'links',
  'calendars',
  'notifications',
  'data',
  'apps',
  'about',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

export interface SettingsSection {
  id: SectionId;
  title: string;
  icon:
    | 'palette'
    | 'link'
    | 'calendar'
    | 'bell'
    | 'database'
    | 'apps'
    | 'user'
    | 'info';
  wide?: boolean;
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: 'appearance', title: 'Appearance', icon: 'palette', wide: true },
  { id: 'account', title: 'Account', icon: 'user' },
  { id: 'links', title: 'Link previews', icon: 'link' },
  { id: 'calendars', title: 'Calendars', icon: 'calendar' },
  { id: 'notifications', title: 'Notifications', icon: 'bell' },
  { id: 'data', title: 'Your data', icon: 'database' },
  { id: 'apps', title: 'Ways to capture', icon: 'apps' },
  { id: 'about', title: 'About', icon: 'info' },
];
