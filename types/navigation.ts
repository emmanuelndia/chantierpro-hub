import type { Role } from '@prisma/client';

export type NavigationItem = {
  href: string;
  label: string;
  title: string;
  description: string;
};

export type WebNavIcon =
  | 'dashboard'
  | 'my-projects'
  | 'projects'
  | 'rh'
  | 'consolidated'
  | 'photos'
  | 'reports'
  | 'logs'
  | 'users'
  | 'profile'
  | 'password';

export type WebNavigationItem = {
  href: string;
  label: string;
  icon: WebNavIcon;
  roles: readonly Role[] | 'all';
  breadcrumb: readonly string[];
};

export type MobileTabIcon = 'home' | 'clock-in' | 'photo' | 'calendar' | 'history' | 'reports' | 'teams' | 'profile' | 'folder';

export type MobileNavigationItem = {
  href: string;
  label: string;
  icon: MobileTabIcon;
  roles: readonly Role[] | 'all';
};
