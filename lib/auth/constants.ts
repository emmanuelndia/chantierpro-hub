import type { Role } from '@prisma/client';

export const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 15 * 60;
export const REFRESH_TOKEN_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
export const REFRESH_COOKIE_NAME = 'chantierpro_refresh';
export const PASSWORD_RESET_DEFAULT = '12345678';

export const WEB_ROUTE_ROLE_MAP: Record<string, Role[]> = {
  '/dashboard': ['COORDINATOR'],
  '/reports/': [
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'ADMIN',
  ],
  '/presences/equipe': [
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'ADMIN',
  ],
  '/web/dashboard': [
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'HR',
    'ADMIN',
  ],
  '/web/my-projects': ['PROJECT_MANAGER', 'ADMIN'],
  '/web/projects/': ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
  '/web/projects': ['DIRECTION', 'ADMIN'],
  '/web/sites/': ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
  '/web/rh': ['HR', 'DIRECTION', 'ADMIN'],
  '/web/consolidated': ['DIRECTION', 'ADMIN'],
  '/web/photos': ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
  '/web/reports': [
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'ADMIN',
  ],
  '/web/deletion-logs': ['DIRECTION', 'ADMIN'],
  '/web/users': ['ADMIN'],
  '/web/profile': [
    'SUPERVISOR',
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'HR',
    'ADMIN',
  ],
  '/web/change-password': [
    'SUPERVISOR',
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'HR',
    'ADMIN',
  ],
  '/web/admin': ['ADMIN'],
  '/web/hr': ['HR', 'DIRECTION', 'ADMIN'],
  '/web/project_manager': ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
  '/web/manager': ['GENERAL_SUPERVISOR', 'PROJECT_MANAGER', 'DIRECTION', 'ADMIN'],
  '/admin/users': ['ADMIN'],
  '/admin/utilisateurs': ['ADMIN'],
  '/admin/logs': ['ADMIN'],
  '/settings/profil': [
    'SUPERVISOR',
    'COORDINATOR',
    'GENERAL_SUPERVISOR',
    'PROJECT_MANAGER',
    'DIRECTION',
    'HR',
    'ADMIN',
  ],
};
