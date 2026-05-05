import type { Role } from '@prisma/client';
import type { MobileNavigationItem, NavigationItem, WebNavigationItem } from '@/types/navigation';

export const webNavigation: readonly WebNavigationItem[] = [
  {
    href: '/dashboard',
    label: 'Tableau de bord',
    icon: 'dashboard',
    roles: ['COORDINATOR'],
    breadcrumb: ['Tableau de bord'],
  },
  {
    href: '/web/dashboard',
    label: 'Tableau de bord',
    icon: 'dashboard',
    roles: ['GENERAL_SUPERVISOR', 'PROJECT_MANAGER', 'DIRECTION', 'HR', 'ADMIN'],
    breadcrumb: ['Tableau de bord'],
  },
  {
    href: '/web/my-projects',
    label: 'Mes projets',
    icon: 'my-projects',
    roles: ['PROJECT_MANAGER', 'ADMIN'],
    breadcrumb: ['Mes projets'],
  },
  {
    href: '/web/projects',
    label: 'Tous les projets',
    icon: 'projects',
    roles: ['DIRECTION', 'ADMIN'],
    breadcrumb: ['Tous les projets'],
  },
  {
    href: '/web/rh/presences',
    label: 'Presences / RH',
    icon: 'rh',
    roles: ['HR', 'DIRECTION', 'ADMIN'],
    breadcrumb: ['Presences / RH'],
  },
  {
    href: '/web/consolidated',
    label: 'Vue consolidee',
    icon: 'consolidated',
    roles: ['DIRECTION', 'ADMIN'],
    breadcrumb: ['Vue consolidee'],
  },
  {
    href: '/web/photos',
    label: 'Galerie photos',
    icon: 'photos',
    roles: ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
    breadcrumb: ['Galerie photos'],
  },
  {
    href: '/web/reports',
    label: 'Rapports terrain',
    icon: 'reports',
    roles: ['COORDINATOR', 'GENERAL_SUPERVISOR', 'PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
    breadcrumb: ['Rapports terrain'],
  },
  {
    href: '/presences/equipe',
    label: 'Presences equipe',
    icon: 'rh',
    roles: ['COORDINATOR', 'GENERAL_SUPERVISOR', 'PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
    breadcrumb: ['Presences', 'Equipe'],
  },
  {
    href: '/web/deletion-logs',
    label: 'Logs de suppression',
    icon: 'logs',
    roles: ['DIRECTION'],
    breadcrumb: ['Logs de suppression'],
  },
  {
    href: '/admin/logs',
    label: 'Logs de suppression',
    icon: 'logs',
    roles: ['ADMIN'],
    breadcrumb: ['Administration', 'Logs'],
  },
  {
    href: '/admin/users',
    label: 'Utilisateurs',
    icon: 'users',
    roles: ['ADMIN'],
    breadcrumb: ['Administration', 'Utilisateurs'],
  },
  {
    href: '/settings/profil',
    label: 'Mon profil',
    icon: 'profile',
    roles: 'all',
    breadcrumb: ['Mon profil'],
  },
] as const;

const webSecondaryRoutes: readonly WebNavigationItem[] = [
  {
    href: '/web/rh/export',
    label: 'Export RH',
    icon: 'rh',
    roles: ['HR', 'DIRECTION', 'ADMIN'],
    breadcrumb: ['Presences / RH', 'Export RH'],
  },
  {
    href: '/web/change-password',
    label: 'Changer mot de passe',
    icon: 'password',
    roles: 'all',
    breadcrumb: ['Mon profil', 'Changer mot de passe'],
  },
  {
    href: '/settings/profil',
    label: 'Mon profil',
    icon: 'profile',
    roles: 'all',
    breadcrumb: ['Parametres', 'Mon profil'],
  },
] as const;

export const mobileNavigation: readonly NavigationItem[] = [
  {
    href: '/mobile/login',
    label: '(auth)',
    title: 'Connexion mobile',
    description: 'Point d entree mobile et PWA.',
  },
  {
    href: '/mobile/admin',
    label: 'admin',
    title: 'Admin mobile',
    description: 'Administration simplifiee sur mobile.',
  },
  {
    href: '/mobile/project_manager',
    label: 'project_manager',
    title: 'Chef de projet mobile',
    description: 'Suivi chantier depuis la PWA.',
  },
  {
    href: '/mobile/manager',
    label: 'manager',
    title: 'Manager mobile',
    description: 'Supervision operationnelle mobile.',
  },
  {
    href: '/mobile/technician',
    label: 'technician',
    title: 'Technicien',
    description: 'Pointage, photos et historique.',
  },
] as const;

export const mobileTabNavigation: readonly MobileNavigationItem[] = [
  {
    href: '/mobile/home',
    label: 'Accueil',
    icon: 'home',
    roles: ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR', 'PROJECT_MANAGER', 'DIRECTION', 'HR', 'ADMIN'],
  },
  {
    href: '/mobile/clock-in',
    label: 'Pointer',
    icon: 'clock-in',
    roles: ['SUPERVISOR', 'COORDINATOR'],
  },
  {
    href: '/mobile/photo',
    label: 'Photo',
    icon: 'photo',
    roles: ['SUPERVISOR', 'COORDINATOR'],
  },
  {
    href: '/mobile/projects',
    label: 'Projets',
    icon: 'folder',
    roles: ['PROJECT_MANAGER', 'DIRECTION'],
  },
  {
    href: '/mobile/gallery',
    label: 'Galerie',
    icon: 'photo',
    roles: ['PROJECT_MANAGER', 'DIRECTION'],
  },
  {
    href: '/mobile/planning',
    label: 'Planning',
    icon: 'calendar',
    roles: ['GENERAL_SUPERVISOR'],
  },
  {
    href: '/mobile/history',
    label: 'Historique',
    icon: 'history',
    roles: ['SUPERVISOR', 'COORDINATOR'],
  },
  {
    href: '/mobile/reports',
    label: 'Rapports',
    icon: 'reports',
    roles: ['COORDINATOR', 'GENERAL_SUPERVISOR'],
  },
  {
    href: '/mobile/teams',
    label: 'Équipes',
    icon: 'teams',
    roles: ['GENERAL_SUPERVISOR'],
  },
  {
    href: '/mobile/profile',
    label: 'Profil',
    icon: 'profile',
    roles: 'all',
  },
] as const;

export function canAccessWebNavigationItem(role: Role, item: WebNavigationItem) {
  return item.roles === 'all' || item.roles.includes(role);
}

export function getWebNavigationForRole(role: Role) {
  return webNavigation.filter((item) => canAccessWebNavigationItem(role, item));
}

export function canAccessMobileNavigationItem(role: Role, item: MobileNavigationItem) {
  return item.roles === 'all' || item.roles.includes(role);
}

export function getMobileNavigationForRole(role: Role) {
  return mobileTabNavigation.filter((item) => canAccessMobileNavigationItem(role, item));
}

export function getWebBreadcrumbs(pathname: string) {
  const match = [...webNavigation, ...webSecondaryRoutes].find((item) => item.href === pathname);

  if (match) {
    return match.breadcrumb;
  }

  if (/^\/web\/projects\/[^/]+$/.test(pathname)) {
    return ['Projets', 'Detail projet'];
  }

  if (/^\/web\/sites\/[^/]+\/presences$/.test(pathname)) {
    return ['Projets', 'Presences chantier'];
  }

  if (pathname === '/admin/users') {
    return ['Administration', 'Utilisateurs'];
  }

  if (pathname === '/admin/logs') {
    return ['Administration', 'Logs'];
  }

  if (pathname === '/settings/profil') {
    return ['Parametres', 'Mon profil'];
  }

  if (pathname === '/dashboard') {
    return ['Tableau de bord'];
  }

  if (pathname === '/presences/equipe') {
    return ['Presences', 'Equipe'];
  }

  return pathname
    .split('/')
    .filter(Boolean)
    .slice(1)
    .map((segment) =>
      segment
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    );
}
