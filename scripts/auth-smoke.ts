import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnvConfig } from '@next/env';
import { PrismaClient, ProjectStatus, Role } from '@prisma/client';
import { compare, hash } from 'bcrypt';
import ExcelJS from 'exceljs';
import sharp from 'sharp';

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();
const TEST_PORT = Number(process.env.AUTH_SMOKE_PORT ?? '3105');
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_IP = '203.0.113.10';

type CookieJar = Map<string, string>;

type LoginPayload = {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    mustChangePassword: boolean;
  };
};

type RefreshPayload = {
  accessToken: string;
  expiresIn: number;
};

type ErrorPayload = {
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
};

type UserPayload = {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    contact: string;
    isActive: boolean;
    mustChangePassword: boolean;
    createdAt: string;
  };
};

type PaginatedUsersPayload = {
  items: UserPayload['user'][];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type CreateUserPayload = UserPayload & {
  temporaryPassword: string;
};

type TestContext = {
  adminId: string;
  directionId: string;
  projectManagerId: string;
  tech1Id: string;
  tech2Id: string;
  tech3Id: string;
  originalTech2Hash: string;
  projectAId: string;
  projectBId: string;
  siteAId: string;
};

const originalPasswords = {
  admin: 'ChantierPro#2026',
  direction: 'ChantierPro#2026',
  projectManager: 'ChantierPro#2026',
  tech1: 'ChantierPro#2026',
  tech2: 'ChantierPro#2026',
  tech3: 'ChantierPro#2026',
} as const;

const smokeUserEmail = 'smoke.user@chantierpro.local';
const smokeProfileEmail = 'smoke.profile@chantierpro.local';
const smokePmEmail = 'smoke.pm@chantierpro.local';
const smokeProjectName = 'Smoke Project Access';
const smokeRadiusSiteName = 'Site Rayon 1.5';
const smokeTeamAlphaName = 'Smoke Team Alpha';
const smokePhotoDescriptionPrefix = 'SMOKE_PHOTO';
const smokeDirectionSiteName = 'Smoke Direction Quiet Site';

const results: { name: string; status: 'passed' | 'failed'; detail?: string }[] = [];

async function main() {
  let startedServer: ChildProcessWithoutNullStreams | null = null;

  try {
    const serverState = await ensureServer();
    startedServer = serverState.process;

    const context = await prepareState();

    await runCase('login valide -> JWT + refresh cookie', testValidLogin);
    await runCase('route protegee sans token -> 401', testProtectedRouteWithoutToken);
    await runCase('route protegee avec role insuffisant -> 403', () =>
      testRoleInsufficient(context),
    );
    await runCase('compte desactive -> ACCOUNT_DISABLED', () => testDisabledAccount(context));
    await runCase('rate limiting login -> TOO_MANY_ATTEMPTS', testLoginRateLimit);
    await runCase('refresh -> rotation silencieuse', () => testRefreshRotation(context));
    await runCase('logout -> revoke + cookie expire', testLogoutFlow);
    await runCase('reset-password admin + mustChangePassword', () =>
      testAdminResetPassword(context),
    );
    await runCase('users admin -> liste paginee + creation + conflit', testAdminUsersCrud);
    await runCase('users admin -> update + email immuable', () =>
      testAdminUserUpdateAndEmailImmutability(context),
    );
    await runCase('users admin -> auto-desactivation interdite', () =>
      testAdminSelfDeactivation(context),
    );
    await runCase('users me -> lecture + edition + mot de passe', testCurrentUserRoutes);
    await runCase('projects -> visibilite PM et direction', () => testProjectVisibility(context));
    await runCase('projects -> validations create/update', () =>
      testProjectValidationAndMutations(context),
    );
    await runCase('projects -> archivage et radius site', () => testProjectArchiveAndRadius(context));
    await runCase('projects -> presences et sites du jour', () => testProjectPresencesAndTodaySites(context));
    await runCase('teams -> creation, doublon, retrait et non assignes', () =>
      testTeamsAndMembers(context),
    );
    await runCase('clock-in -> gps, sessions, historique, attendance et sync', () =>
      testClockInFlows(context),
    );
    await runCase('rh -> presences mensuelles, detail, exports et historique', () =>
      testRhModule(context),
    );
    await runCase('photos -> upload, visibilite, suppression et logs', () =>
      testPhotoFlows(context),
    );
    await runCase('direction -> kpis, consolidation, carte et alertes', () =>
      testDirectionModule(context),
    );
    await runCase('push-token -> create puis update', () => testPushToken(context));
    await runCase('middleware web -> redirects + acces autorise', testMiddlewareRoutes);
    await runCase('authFetch -> retry puis echec propre', testAuthFetchHelper);
  } finally {
    await restoreState();
    await prisma.$disconnect();

    if (startedServer) {
      startedServer.kill();
    }
  }

  printSummary();

  const failures = results.filter((result) => result.status === 'failed');

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function runCase(name: string, fn: () => Promise<void>) {
  try {
    console.log(`Running: ${name}`);
    await fn();
    results.push({ name, status: 'passed' });
    console.log(`Passed: ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, status: 'failed', detail });
    console.log(`Failed: ${name}`);
  }
}

async function prepareState(): Promise<TestContext> {
  await cleanupSmokeEntities();

  await prisma.loginAttempt.deleteMany();
  await prisma.pushToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.report.deleteMany();
  await prisma.rhExportHistory.deleteMany();
  await prisma.photoDeletionLog.deleteMany({
    where: {
      photo: {
        description: {
          startsWith: smokePhotoDescriptionPrefix,
        },
      },
    },
  });
  await prisma.photo.deleteMany({
    where: {
      description: {
        startsWith: smokePhotoDescriptionPrefix,
      },
    },
  });

  const tech1PasswordHash = await hash(originalPasswords.tech1, 10);
  const tech2PasswordHash = await hash(originalPasswords.tech2, 10);
  const tech3PasswordHash = await hash(originalPasswords.tech3, 10);

  await prisma.user.update({
    where: { email: 'superviseur@chantierpro.local' },
    data: {
      passwordHash: tech1PasswordHash,
      role: Role.SUPERVISOR,
      mustChangePassword: false,
      isActive: true,
    },
  });

  await prisma.user.update({
    where: { email: 'coordinateur@chantierpro.local' },
    data: {
      passwordHash: tech2PasswordHash,
      role: Role.COORDINATOR,
      mustChangePassword: false,
      isActive: true,
    },
  });

  await prisma.user.update({
    where: { email: 'sup.general@chantierpro.local' },
    data: {
      passwordHash: tech3PasswordHash,
      role: Role.GENERAL_SUPERVISOR,
      mustChangePassword: false,
      isActive: true,
    },
  });

  const users = await prisma.user.findMany({
    where: {
      email: {
        in: [
          'admin@chantierpro.local',
          'direction@chantierpro.local',
          'manager@chantierpro.local',
          'superviseur@chantierpro.local',
          'coordinateur@chantierpro.local',
          'sup.general@chantierpro.local',
        ],
      },
    },
    select: {
      id: true,
      email: true,
      passwordHash: true,
    },
  });

  const byEmail = new Map(users.map((user) => [user.email, user]));

  const admin = byEmail.get('admin@chantierpro.local');
  const direction = byEmail.get('direction@chantierpro.local');
  const projectManager = byEmail.get('manager@chantierpro.local');
  const tech1 = byEmail.get('superviseur@chantierpro.local');
  const tech2 = byEmail.get('coordinateur@chantierpro.local');
  const tech3 = byEmail.get('sup.general@chantierpro.local');

  if (!admin || !direction || !projectManager || !tech1 || !tech2 || !tech3) {
    throw new Error('Missing seeded auth users');
  }

  const projects = await prisma.project.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      sites: {
        select: {
          id: true,
          name: true,
          status: true,
        },
      },
    },
  });

  const projectA = projects.find((project) => project.status === 'IN_PROGRESS');
  const projectB = projects.find((project) => project.status === 'ON_HOLD');
  const siteA = projectA?.sites.find((site) => site.status === 'ACTIVE');

  if (!projectA || !projectB || !siteA) {
    throw new Error('Missing seeded projects or sites');
  }

  return {
    adminId: admin.id,
    directionId: direction.id,
    projectManagerId: projectManager.id,
    tech1Id: tech1.id,
    tech2Id: tech2.id,
    tech3Id: tech3.id,
    originalTech2Hash: tech2.passwordHash,
    projectAId: projectA.id,
    projectBId: projectB.id,
    siteAId: siteA.id,
  };
}

async function restoreState() {
  await cleanupSmokeEntities();

  await prisma.loginAttempt.deleteMany();
  await prisma.pushToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.report.deleteMany();
  await prisma.rhExportHistory.deleteMany();
  await prisma.photoDeletionLog.deleteMany({
    where: {
      photo: {
        description: {
          startsWith: smokePhotoDescriptionPrefix,
        },
      },
    },
  });
  await prisma.photo.deleteMany({
    where: {
      description: {
        startsWith: smokePhotoDescriptionPrefix,
      },
    },
  });

  await prisma.user.update({
    where: { email: 'superviseur@chantierpro.local' },
    data: {
      passwordHash: await hash(originalPasswords.tech1, 10),
      role: Role.SUPERVISOR,
      mustChangePassword: false,
      isActive: true,
    },
  });

  await prisma.user.update({
    where: { email: 'coordinateur@chantierpro.local' },
    data: {
      passwordHash: await hash(originalPasswords.tech2, 10),
      role: Role.COORDINATOR,
      mustChangePassword: false,
      isActive: true,
    },
  });

  await prisma.user.update({
    where: { email: 'sup.general@chantierpro.local' },
    data: {
      passwordHash: await hash(originalPasswords.tech3, 10),
      role: Role.GENERAL_SUPERVISOR,
      mustChangePassword: false,
      isActive: true,
    },
  });
}

async function cleanupSmokeEntities() {
  const tempUsers = await prisma.user.findMany({
    where: {
      email: {
        in: [smokeUserEmail, smokeProfileEmail, smokePmEmail],
      },
    },
    select: {
      id: true,
    },
  });
  const tempUserIds = tempUsers.map((user) => user.id);

  const tempProjects = await prisma.project.findMany({
    where: {
      OR: [
        {
          name: smokeProjectName,
        },
        ...(tempUserIds.length > 0
          ? [
              {
                projectManagerId: {
                  in: tempUserIds,
                },
              },
              {
                createdById: {
                  in: tempUserIds,
                },
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
    },
  });
  const tempProjectIds = tempProjects.map((project) => project.id);

  if (tempProjectIds.length > 0) {
    await prisma.photoDeletionLog.deleteMany({
      where: {
        photo: {
          site: {
            projectId: {
              in: tempProjectIds,
            },
          },
        },
      },
    });

    await prisma.photo.deleteMany({
      where: {
        site: {
          projectId: {
            in: tempProjectIds,
          },
        },
      },
    });

    await prisma.report.deleteMany({
      where: {
        site: {
          projectId: {
            in: tempProjectIds,
          },
        },
      },
    });

    await prisma.clockInRecord.deleteMany({
      where: {
        site: {
          projectId: {
            in: tempProjectIds,
          },
        },
      },
    });

    await prisma.site.deleteMany({
      where: {
        projectId: {
          in: tempProjectIds,
        },
      },
    });

    await prisma.project.deleteMany({
      where: {
        id: {
          in: tempProjectIds,
        },
      },
    });
  }

  await prisma.report.deleteMany({
    where: {
      site: {
        name: smokeRadiusSiteName,
      },
    },
  });

  await prisma.rhExportHistory.deleteMany();

  await prisma.photoDeletionLog.deleteMany({
    where: {
      photo: {
        site: {
          name: smokeRadiusSiteName,
        },
      },
    },
  });

  await prisma.photo.deleteMany({
    where: {
      site: {
        name: smokeRadiusSiteName,
      },
    },
  });

  await prisma.clockInRecord.deleteMany({
    where: {
      site: {
        name: smokeRadiusSiteName,
      },
    },
  });

  await prisma.team.deleteMany({
    where: {
      name: {
        startsWith: smokeTeamAlphaName,
      },
    },
  });

  await prisma.site.deleteMany({
    where: {
      name: smokeRadiusSiteName,
    },
  });

  await prisma.user.deleteMany({
    where: {
      email: {
        in: [smokeUserEmail, smokeProfileEmail, smokePmEmail],
      },
    },
  });
}

async function ensureServer() {
  const healthy = await pingHealth();

  if (healthy) {
    return { process: null as ChildProcessWithoutNullStreams | null };
  }

  const child = spawn(`npm run dev -- --port ${TEST_PORT}`, [], {
    cwd: process.cwd(),
    stdio: 'pipe',
    shell: true,
  });

  child.stdout.on('data', () => undefined);
  child.stderr.on('data', () => undefined);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await pingHealth()) {
      return { process: child };
    }

    await delay(1000);
  }

  child.kill();
  throw new Error(`next dev did not become ready on localhost:${TEST_PORT}`);
}

async function pingHealth() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function testValidLogin() {
  await prisma.loginAttempt.deleteMany({
    where: { emailOrKey: 'admin@chantierpro.local' },
  });

  const jar = createCookieJar();
  const response = await request('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@chantierpro.local',
      password: originalPasswords.admin,
    },
    cookieJar: jar,
  });

  assert.equal(response.status, 200);

  const payload = (await response.json()) as LoginPayload;
  assert.ok(payload.accessToken.length > 20);
  assert.equal(payload.user.role, 'ADMIN');
  assert.ok(payload.expiresIn > 0);

  const refreshCookie = jar.get('chantierpro_refresh');
  assert.ok(refreshCookie);
  const refreshSetCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('chantierpro_refresh='));

  assert.ok(refreshSetCookie?.includes('HttpOnly'));
}

async function testProtectedRouteWithoutToken() {
  const response = await request('/api/auth/me');
  assert.equal(response.status, 401);
}

async function testRoleInsufficient(context: TestContext) {
  const login = await loginWithJar('superviseur@chantierpro.local', originalPasswords.tech1);
  const response = await request(`/api/users/${context.tech2Id}/reset-password`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${login.payload.accessToken}`,
    },
  });

  assert.equal(response.status, 403);
}

async function testDisabledAccount(context: TestContext) {
  await prisma.user.update({
    where: { id: context.tech3Id },
    data: {
      isActive: false,
    },
  });

  try {
    const response = await request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '203.0.113.11',
      },
      body: {
        email: 'sup.general@chantierpro.local',
        password: originalPasswords.tech3,
      },
    });

    assert.equal(response.status, 403);
    const payload = (await response.json()) as ErrorPayload;
    assert.equal(payload.code, 'ACCOUNT_DISABLED');
  } finally {
    await prisma.user.update({
      where: { id: context.tech3Id },
      data: {
        isActive: true,
      },
    });
  }
}

async function testLoginRateLimit() {
  const email = 'superviseur@chantierpro.local';

  await prisma.loginAttempt.deleteMany({
    where: { emailOrKey: email, ipAddress: TEST_IP },
  });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await request('/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': TEST_IP,
      },
      body: {
        email,
        password: 'wrong-password',
      },
    });

    assert.equal(response.status, 401, `Attempt ${attempt} should still be invalid credentials`);
    const payload = (await response.json()) as ErrorPayload;
    assert.equal(payload.code, 'INVALID_CREDENTIALS');
  }

  const blockedResponse = await request('/api/auth/login', {
    method: 'POST',
    headers: {
      'x-forwarded-for': TEST_IP,
    },
    body: {
      email,
      password: 'wrong-password',
    },
  });

  assert.equal(blockedResponse.status, 429);
  const payload = (await blockedResponse.json()) as ErrorPayload;
  assert.equal(payload.code, 'TOO_MANY_ATTEMPTS');
  assert.ok((payload.retryAfterSeconds ?? 0) > 0);
  assert.ok(Number(blockedResponse.headers.get('Retry-After') ?? '0') > 0);
}

async function testRefreshRotation(context: TestContext) {
  const login = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);
  const previousRefresh = login.jar.get('chantierpro_refresh');

  assert.ok(previousRefresh);

  const refreshResponse = await request('/api/auth/refresh', {
    method: 'POST',
    cookieJar: login.jar,
  });

  assert.equal(refreshResponse.status, 200);
  const refreshed = (await refreshResponse.json()) as RefreshPayload;
  assert.ok(refreshed.accessToken.length > 20);
  assert.notEqual(refreshed.accessToken, login.payload.accessToken);

  const nextRefresh = login.jar.get('chantierpro_refresh');
  assert.ok(nextRefresh);
  assert.notEqual(nextRefresh, previousRefresh);

  const oldRecord = await prisma.refreshToken.findUnique({
    where: {
      tokenHash: hashToken(previousRefresh ?? ''),
    },
  });

  assert.ok(oldRecord?.revokedAt);

  void context;
}

async function testLogoutFlow() {
  const login = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);
  const currentRefresh = login.jar.get('chantierpro_refresh');

  assert.ok(currentRefresh);

  const logoutResponse = await request('/api/auth/logout', {
    method: 'POST',
    cookieJar: login.jar,
  });

  assert.equal(logoutResponse.status, 204);
  const logoutCookie = logoutResponse.headers
    .getSetCookie()
    .find((value) => value.startsWith('chantierpro_refresh='));

  assert.ok(logoutCookie?.includes('Max-Age=0'));

  const tokenRecord = await prisma.refreshToken.findUnique({
    where: {
      tokenHash: hashToken(currentRefresh ?? ''),
    },
  });

  assert.ok(tokenRecord?.revokedAt);

  const refreshAfterLogout = await request('/api/auth/refresh', {
    method: 'POST',
    headers: {
      Cookie: `chantierpro_refresh=${currentRefresh ?? ''}`,
    },
  });

  assert.equal(refreshAfterLogout.status, 401);
}

async function testAdminResetPassword(context: TestContext) {
  const adminLogin = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);

  const resetResponse = await request(`/api/users/${context.tech2Id}/reset-password`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
  });

  assert.equal(resetResponse.status, 204);

  const updatedUser = await prisma.user.findUnique({
    where: { id: context.tech2Id },
    select: {
      mustChangePassword: true,
      passwordHash: true,
    },
  });

  assert.equal(updatedUser?.mustChangePassword, true);
  assert.ok(updatedUser?.passwordHash);
  assert.equal(await compare('ChantierPro#2026', updatedUser?.passwordHash ?? ''), true);

  const tech2Login = await loginWithJar('coordinateur@chantierpro.local', 'ChantierPro#2026');
  assert.equal(tech2Login.payload.user.mustChangePassword, true);

  const meResponse = await request('/api/auth/me', {
    headers: {
      Authorization: `Bearer ${tech2Login.payload.accessToken}`,
    },
  });

  assert.equal(meResponse.status, 200);
  const mePayload = (await meResponse.json()) as { user: { mustChangePassword: boolean } };
  assert.equal(mePayload.user.mustChangePassword, true);

  await prisma.user.update({
    where: { id: context.tech2Id },
    data: {
      passwordHash: context.originalTech2Hash,
      mustChangePassword: false,
    },
  });
}

async function testAdminUsersCrud() {
  await prisma.user.deleteMany({
    where: {
      email: smokeUserEmail,
    },
  });

  const adminLogin = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);

  const forbiddenList = await request('/api/users?page=1', {
    headers: {
      Authorization: `Bearer ${(await loginWithJar('superviseur@chantierpro.local', originalPasswords.tech1)).payload.accessToken}`,
    },
  });

  assert.equal(forbiddenList.status, 403);

  const listResponse = await request('/api/users?page=1', {
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
  });

  assert.equal(listResponse.status, 200);
  const listPayload = (await listResponse.json()) as PaginatedUsersPayload;
  assert.equal(listPayload.page, 1);
  assert.equal(listPayload.pageSize, 15);
  assert.ok(Array.isArray(listPayload.items));
  assert.ok(listPayload.totalItems >= listPayload.items.length);

  const createResponse = await request('/api/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      email: smokeUserEmail,
      firstName: 'Smoke',
      lastName: 'User',
      role: 'SUPERVISOR',
      contact: '+2250102030405',
    },
  });

  assert.equal(createResponse.status, 201);
  const createPayload = (await createResponse.json()) as CreateUserPayload;
  assert.equal(createPayload.user.email, smokeUserEmail);
  assert.equal(createPayload.user.mustChangePassword, true);
  assert.ok(createPayload.temporaryPassword.length >= 8);

  const duplicateResponse = await request('/api/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      email: smokeUserEmail,
      firstName: 'Smoke',
      lastName: 'User',
      role: 'SUPERVISOR',
      contact: '+2250102030405',
    },
  });

  assert.equal(duplicateResponse.status, 409);
  const duplicatePayload = (await duplicateResponse.json()) as ErrorPayload;
  assert.equal(duplicatePayload.code, 'CONFLICT');
}

async function testAdminUserUpdateAndEmailImmutability(context: TestContext) {
  const adminLogin = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);

  const getResponse = await request(`/api/users/${context.tech1Id}`, {
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
  });

  assert.equal(getResponse.status, 200);
  const getPayload = (await getResponse.json()) as UserPayload;
  assert.equal(getPayload.user.id, context.tech1Id);

  const updateResponse = await request(`/api/users/${context.tech1Id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      firstName: 'Tech',
      lastName: 'Updated',
      role: 'SUPERVISOR',
      contact: '+2250700000000',
    },
  });

  assert.equal(updateResponse.status, 200);
  const updatePayload = (await updateResponse.json()) as UserPayload;
  assert.equal(updatePayload.user.lastName, 'Updated');
  assert.equal(updatePayload.user.contact, '+2250700000000');
  assert.equal(updatePayload.user.email, 'superviseur@chantierpro.local');

  const immutableResponse = await request(`/api/users/${context.tech1Id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      email: 'changed@chantierpro.local',
      firstName: 'Tech',
      lastName: 'Updated',
      role: 'SUPERVISOR',
      contact: '+2250700000000',
    },
  });

  assert.equal(immutableResponse.status, 400);
  const immutablePayload = (await immutableResponse.json()) as ErrorPayload;
  assert.equal(immutablePayload.code, 'EMAIL_IMMUTABLE');

  await prisma.user.update({
    where: { id: context.tech1Id },
    data: {
      firstName: 'Tech',
      lastName: 'One',
      contact: '+2250101010101',
    },
  });
}

async function testAdminSelfDeactivation(context: TestContext) {
  const adminLogin = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);

  const response = await request(`/api/users/${context.adminId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      isActive: false,
    },
  });

  assert.equal(response.status, 400);
  const payload = (await response.json()) as ErrorPayload;
  assert.equal(payload.code, 'SELF_DEACTIVATION_FORBIDDEN');
  assert.match(payload.message ?? '', /desactiver/i);
}

async function testCurrentUserRoutes() {
  await prisma.user.deleteMany({
    where: {
      email: smokeProfileEmail,
    },
  });

  const adminLogin = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);

  const createResponse = await request('/api/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      email: smokeProfileEmail,
      firstName: 'Smoke',
      lastName: 'User',
      role: 'SUPERVISOR',
      contact: '+2250102030405',
    },
  });

  assert.equal(createResponse.status, 201);
  const createPayload = (await createResponse.json()) as CreateUserPayload;

  const smokeLogin = await loginWithJar(smokeProfileEmail, createPayload.temporaryPassword);
  const originalRefresh = smokeLogin.jar.get('chantierpro_refresh');
  assert.ok(originalRefresh);

  const meResponse = await request('/api/users/me', {
    headers: {
      Authorization: `Bearer ${smokeLogin.payload.accessToken}`,
    },
  });

  assert.equal(meResponse.status, 200);
  const mePayload = (await meResponse.json()) as UserPayload;
  assert.equal(mePayload.user.email, smokeProfileEmail);
  assert.equal(mePayload.user.contact, '+2250102030405');

  const updateProfileResponse = await request('/api/users/me', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${smokeLogin.payload.accessToken}`,
    },
    body: {
      firstName: 'Updated',
      lastName: 'Profile',
      contact: '+2250999999999',
    },
  });

  assert.equal(updateProfileResponse.status, 200);
  const updateProfilePayload = (await updateProfileResponse.json()) as UserPayload;
  assert.equal(updateProfilePayload.user.firstName, 'Updated');
  assert.equal(updateProfilePayload.user.contact, '+2250999999999');

  const immutableResponse = await request('/api/users/me', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${smokeLogin.payload.accessToken}`,
    },
    body: {
      email: 'other@chantierpro.local',
      firstName: 'Updated',
      lastName: 'Profile',
      contact: '+2250999999999',
    },
  });

  assert.equal(immutableResponse.status, 400);
  const immutablePayload = (await immutableResponse.json()) as ErrorPayload;
  assert.equal(immutablePayload.code, 'EMAIL_IMMUTABLE');

  const invalidPasswordResponse = await request('/api/users/me/password', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${smokeLogin.payload.accessToken}`,
    },
    body: {
      currentPassword: createPayload.temporaryPassword,
      newPassword: 'weak',
    },
    cookieJar: smokeLogin.jar,
  });

  assert.equal(invalidPasswordResponse.status, 400);
  const invalidPasswordPayload = (await invalidPasswordResponse.json()) as ErrorPayload;
  assert.equal(invalidPasswordPayload.code, 'INVALID_PASSWORD');

  const changePasswordResponse = await request('/api/users/me/password', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${smokeLogin.payload.accessToken}`,
    },
    body: {
      currentPassword: createPayload.temporaryPassword,
      newPassword: 'UpdatedPass1',
    },
    cookieJar: smokeLogin.jar,
  });

  assert.equal(changePasswordResponse.status, 204);
  const expiredCookie = changePasswordResponse.headers
    .getSetCookie()
    .find((value) => value.startsWith('chantierpro_refresh='));
  assert.ok(expiredCookie?.includes('Max-Age=0'));

  const updatedUser = await prisma.user.findUnique({
    where: { email: smokeProfileEmail },
    select: {
      mustChangePassword: true,
    },
  });

  assert.equal(updatedUser?.mustChangePassword, false);

  const revokedRecord = await prisma.refreshToken.findUnique({
    where: {
      tokenHash: hashToken(originalRefresh ?? ''),
    },
  });

  assert.ok(revokedRecord?.revokedAt);

  const refreshAfterPasswordChange = await request('/api/auth/refresh', {
    method: 'POST',
    headers: {
      Cookie: `chantierpro_refresh=${originalRefresh ?? ''}`,
    },
  });

  assert.equal(refreshAfterPasswordChange.status, 401);

  const relogin = await loginWithJar(smokeProfileEmail, 'UpdatedPass1');
  assert.equal(relogin.payload.user.mustChangePassword, false);
}

async function testPushToken(context: TestContext) {
  const login = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);
  const token = 'push-token-device-001';

  const createResponse = await request('/api/auth/push-token', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${login.payload.accessToken}`,
    },
    body: {
      token,
      platform: 'web',
      deviceLabel: 'Office workstation',
    },
  });

  assert.equal(createResponse.status, 204);

  const updateResponse = await request('/api/auth/push-token', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${login.payload.accessToken}`,
    },
    body: {
      token,
      platform: 'web',
      deviceLabel: 'Updated device name',
    },
  });

  assert.equal(updateResponse.status, 204);

  const pushTokens = await prisma.pushToken.findMany({
    where: {
      token,
      userId: context.adminId,
    },
  });

  assert.equal(pushTokens.length, 1);
  assert.equal(pushTokens[0]?.deviceLabel, 'Updated device name');
}

async function testProjectVisibility(context: TestContext) {
  const secondPmPasswordHash = await hash('SecondPm#2026', 10);
  const secondPm = await prisma.user.create({
    data: {
      email: smokePmEmail,
      firstName: 'Second',
      lastName: 'Manager',
      role: Role.PROJECT_MANAGER,
      contact: '+2250707070707',
      isActive: true,
      mustChangePassword: false,
      passwordHash: secondPmPasswordHash,
    },
  });

  await prisma.project.create({
    data: {
      name: smokeProjectName,
      description: 'Projet de test de visibilite.',
      address: 'Zone de test',
      city: 'Abidjan',
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      status: ProjectStatus.IN_PROGRESS,
      projectManagerId: secondPm.id,
      createdById: context.adminId,
    },
  });

  const pmLogin = await loginWithJar('manager@chantierpro.local', originalPasswords.projectManager);
  const pmResponse = await request('/api/projects', {
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
  });

  assert.equal(pmResponse.status, 200);
  const pmPayload = (await pmResponse.json()) as { items: { id: string; name: string }[] };
  assert.ok(pmPayload.items.every((item) => item.name !== smokeProjectName));

  const foreignProject = await prisma.project.findFirstOrThrow({
    where: { name: smokeProjectName },
    select: { id: true },
  });

  const pmForeignResponse = await request(`/api/projects/${foreignProject.id}`, {
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
  });

  assert.equal(pmForeignResponse.status, 404);

  const directionLogin = await loginWithJar('direction@chantierpro.local', originalPasswords.direction);
  const directionResponse = await request('/api/projects', {
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
  });

  assert.equal(directionResponse.status, 200);
  const directionPayload = (await directionResponse.json()) as { items: { name: string }[] };
  assert.ok(directionPayload.items.some((item) => item.name === smokeProjectName));
}

async function testProjectValidationAndMutations(context: TestContext) {
  const technicianLogin = await loginWithJar('superviseur@chantierpro.local', originalPasswords.tech1);
  const forbiddenCreateProject = await request('/api/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${technicianLogin.payload.accessToken}`,
    },
    body: {
      name: 'Projet interdit',
      description: 'Test',
      address: 'Abidjan',
      city: 'Abidjan',
      startDate: '2026-06-01',
      endDate: '2026-07-01',
      projectManagerId: context.projectManagerId,
    },
  });

  assert.equal(forbiddenCreateProject.status, 403);

  const pmLogin = await loginWithJar('manager@chantierpro.local', originalPasswords.projectManager);
  const invalidName = await request('/api/projects', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
    body: {
      name: 'AB',
      description: 'Projet trop court',
      address: 'Abidjan',
      city: 'Abidjan',
      startDate: '2026-06-01',
      endDate: '2026-07-01',
      projectManagerId: context.projectManagerId,
    },
  });

  assert.equal(invalidName.status, 400);

  const invalidDates = await request(`/api/projects/${context.projectAId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
    body: {
      name: 'RÃƒÂ©novation Plateau',
      description: 'RÃƒÂ©habilitation complÃƒÂ¨te dÃ¢â‚¬â„¢un immeuble administratif.',
      address: 'Rue de Lyon',
      city: 'Abidjan',
      startDate: '2026-12-31',
      endDate: '2026-01-01',
      status: 'IN_PROGRESS',
      projectManagerId: context.projectManagerId,
    },
  });

  assert.equal(invalidDates.status, 400);

  const forbiddenSiteUpdate = await request(`/api/sites/${context.siteAId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${technicianLogin.payload.accessToken}`,
    },
    body: {
      name: 'BÃƒÂ¢timent A',
      address: 'Rue de Lyon, Plateau',
      latitude: 5.36,
      longitude: -4.0083,
      radiusKm: 2,
      description: 'test',
      status: 'ACTIVE',
      area: 500,
      startDate: '2026-02-01',
      endDate: '2026-10-31',
      siteManagerId: context.projectManagerId,
    },
  });

  assert.equal(forbiddenSiteUpdate.status, 403);
}

async function testProjectArchiveAndRadius(context: TestContext) {
  const pmLogin = await loginWithJar('manager@chantierpro.local', originalPasswords.projectManager);
  const directionLogin = await loginWithJar('direction@chantierpro.local', originalPasswords.direction);

  const archiveActiveProject = await request(`/api/projects/${context.projectAId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
  });

  assert.equal(archiveActiveProject.status, 400);
  const archiveError = (await archiveActiveProject.json()) as ErrorPayload;
  assert.equal(archiveError.code, 'PROJECT_HAS_ACTIVE_SITES');

  const archiveClosedProject = await request(`/api/projects/${context.projectBId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
  });

  assert.equal(archiveClosedProject.status, 200);
  const archivedPayload = (await archiveClosedProject.json()) as {
    project: { status: string };
  };
  assert.equal(archivedPayload.project.status, 'ARCHIVED');

  const createOnArchivedProject = await request(`/api/projects/${context.projectBId}/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
    body: {
      name: 'Site interdit',
      address: 'Test',
      latitude: 5.3,
      longitude: -4,
      radiusKm: 1.5,
      description: 'Test',
      status: 'ACTIVE',
      area: 300,
      startDate: '2026-06-01',
      endDate: '2026-07-01',
      siteManagerId: context.projectManagerId,
    },
  });

  assert.equal(createOnArchivedProject.status, 400);
  const closedPayload = (await createOnArchivedProject.json()) as ErrorPayload;
  assert.equal(closedPayload.code, 'PROJECT_CLOSED');

  await prisma.project.update({
    where: { id: context.projectBId },
    data: {
      status: ProjectStatus.ON_HOLD,
    },
  });

  const pmCreateWithRadiusResponse = await request(`/api/projects/${context.projectBId}/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
    body: {
      name: 'Site Rayon 1.5',
      address: 'Zone test',
      latitude: 5.301,
      longitude: -3.999,
      radiusKm: 1.5,
      description: 'Validation rayon',
      status: 'ACTIVE',
      area: 250,
      startDate: '2026-06-01',
      endDate: '2026-07-01',
      siteManagerId: context.projectManagerId,
    },
  });

  assert.equal(pmCreateWithRadiusResponse.status, 403);
  const pmCreateWithRadiusPayload = (await pmCreateWithRadiusResponse.json()) as ErrorPayload;
  assert.equal(pmCreateWithRadiusPayload.code, 'GEOFENCING_FORBIDDEN');

  const pmCreateWithoutRadiusResponse = await request(`/api/projects/${context.projectBId}/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
    body: {
      name: 'Site Rayon Defaut PM',
      address: 'Zone test PM',
      latitude: 5.302,
      longitude: -3.998,
      description: 'Rayon par defaut',
      status: 'ACTIVE',
      area: 240,
      startDate: '2026-06-02',
      endDate: '2026-07-02',
      siteManagerId: context.projectManagerId,
    },
  });

  assert.equal(pmCreateWithoutRadiusResponse.status, 201);
  const pmDefaultSitePayload = (await pmCreateWithoutRadiusResponse.json()) as {
    site: { id: string; radiusKm: number };
  };
  assert.equal(pmDefaultSitePayload.site.radiusKm, 2);

  const pmUpdateRadiusResponse = await request(`/api/sites/${pmDefaultSitePayload.site.id}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
    body: {
      name: 'Site Rayon Defaut PM',
      address: 'Zone test PM',
      latitude: 5.302,
      longitude: -3.998,
      radiusKm: 1.5,
      description: 'Rayon par defaut',
      status: 'ACTIVE',
      area: 240,
      startDate: '2026-06-02',
      endDate: '2026-07-02',
      siteManagerId: context.projectManagerId,
    },
  });

  assert.equal(pmUpdateRadiusResponse.status, 403);
  const pmUpdateRadiusPayload = (await pmUpdateRadiusResponse.json()) as ErrorPayload;
  assert.equal(pmUpdateRadiusPayload.code, 'GEOFENCING_FORBIDDEN');

  const directionCreateSiteResponse = await request(`/api/projects/${context.projectBId}/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
    body: {
      name: 'Site Rayon 1.5',
      address: 'Zone test',
      latitude: 5.301,
      longitude: -3.999,
      radiusKm: 1.5,
      description: 'Validation rayon',
      status: 'ACTIVE',
      area: 250,
      startDate: '2026-06-01',
      endDate: '2026-07-01',
      siteManagerId: context.projectManagerId,
    },
  });

  assert.equal(directionCreateSiteResponse.status, 201);
  const sitePayload = (await directionCreateSiteResponse.json()) as {
    site: { id: string; radiusKm: number };
  };
  assert.equal(sitePayload.site.radiusKm, 1.5);

  const storedSite = await prisma.site.findUniqueOrThrow({
    where: { id: sitePayload.site.id },
    select: { radiusKm: true },
  });

  assert.equal(storedSite.radiusKm.toNumber(), 1.5);
}

async function testProjectPresencesAndTodaySites(context: TestContext) {
  await prisma.clockInRecord.deleteMany({
    where: {
      siteId: context.siteAId,
      userId: {
        in: [context.tech1Id, context.tech3Id],
      },
    },
  });

  const today = new Date();
  const todayDate = new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const arrivalTime = new Date(`${today.toISOString().slice(0, 10)}T08:00:00.000Z`);
  const departureTime = new Date(`${today.toISOString().slice(0, 10)}T17:00:00.000Z`);

  await prisma.clockInRecord.createMany({
    data: [
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'ARRIVAL',
        clockInDate: todayDate,
        clockInTime: arrivalTime,
        latitude: '5.360000',
        longitude: '-4.008300',
        distanceToSite: '0.50',
        status: 'VALID',
        timestampLocal: arrivalTime,
      },
      {
        siteId: context.siteAId,
        userId: context.tech3Id,
        type: 'ARRIVAL',
        clockInDate: todayDate,
        clockInTime: arrivalTime,
        latitude: '5.360000',
        longitude: '-4.008300',
        distanceToSite: '0.40',
        status: 'VALID',
        timestampLocal: arrivalTime,
      },
      {
        siteId: context.siteAId,
        userId: context.tech3Id,
        type: 'DEPARTURE',
        clockInDate: todayDate,
        clockInTime: departureTime,
        latitude: '5.360000',
        longitude: '-4.008300',
        distanceToSite: '0.40',
        status: 'VALID',
        timestampLocal: departureTime,
      },
    ],
  });

  const pmLogin = await loginWithJar('manager@chantierpro.local', originalPasswords.projectManager);
  const presencesResponse = await request(`/api/projects/${context.projectAId}/presences`, {
    headers: {
      Authorization: `Bearer ${pmLogin.payload.accessToken}`,
    },
  });

  assert.equal(presencesResponse.status, 200);
  const presencesPayload = (await presencesResponse.json()) as {
    projectId: string;
    totals: { presentWorkers: number };
    sites: { id: string; presentCount: number; workers: { userId: string }[] }[];
  };
  assert.equal(presencesPayload.projectId, context.projectAId);
  const sitePresence = presencesPayload.sites.find((site) => site.id === context.siteAId);
  assert.ok(sitePresence);
  assert.equal(sitePresence?.presentCount, 1);
  assert.deepEqual(sitePresence?.workers.map((worker) => worker.userId), [context.tech1Id]);

  const techLogin = await loginWithJar('superviseur@chantierpro.local', originalPasswords.tech1);
  const todaySitesResponse = await request('/api/users/me/sites/today', {
    headers: {
      Authorization: `Bearer ${techLogin.payload.accessToken}`,
    },
  });

  assert.equal(todaySitesResponse.status, 200);
  const todaySitesPayload = (await todaySitesResponse.json()) as {
    items: { id: string; radiusKm: number; hasOpenSession: boolean }[];
  };
  const todaySite = todaySitesPayload.items.find((item) => item.id === context.siteAId);
  assert.ok(todaySite);
  assert.equal(todaySite?.hasOpenSession, true);

  const directionLogin = await loginWithJar('direction@chantierpro.local', originalPasswords.direction);
  const forbiddenTodaySites = await request('/api/users/me/sites/today', {
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
  });

  assert.equal(forbiddenTodaySites.status, 403);
}

async function testTeamsAndMembers(context: TestContext) {
  await prisma.team.deleteMany({
    where: {
      name: {
        startsWith: smokeTeamAlphaName,
      },
    },
  });

  await prisma.user.upsert({
    where: {
      email: smokeUserEmail,
    },
    update: {
      firstName: 'Smoke',
      lastName: 'User',
      role: Role.SUPERVISOR,
      contact: '+2250102030405',
      isActive: true,
      mustChangePassword: true,
      passwordHash: await hash('Smoke#2026', 10),
    },
    create: {
      email: smokeUserEmail,
      firstName: 'Smoke',
      lastName: 'User',
      role: Role.SUPERVISOR,
      contact: '+2250102030405',
      isActive: true,
      mustChangePassword: true,
      passwordHash: await hash('Smoke#2026', 10),
    },
  });

  const technicianLogin = await loginWithJar('superviseur@chantierpro.local', originalPasswords.tech1);
  const forbiddenCreate = await request(`/api/sites/${context.siteAId}/teams`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${technicianLogin.payload.accessToken}`,
    },
    body: {
      name: smokeTeamAlphaName,
      teamLeadId: context.tech1Id,
      status: 'ACTIVE',
    },
  });

  assert.equal(forbiddenCreate.status, 403);

  const projectManagerLogin = await loginWithJar(
    'manager@chantierpro.local',
    originalPasswords.projectManager,
  );

  const createTeamResponse = await request(`/api/sites/${context.siteAId}/teams`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
    body: {
      name: smokeTeamAlphaName,
      teamLeadId: context.tech1Id,
      status: 'ACTIVE',
    },
  });

  assert.equal(createTeamResponse.status, 201);
  const createTeamPayload = (await createTeamResponse.json()) as {
    team: {
      id: string;
      teamLeadId: string;
      members: { userId: string; teamRole: string; status: string }[];
    };
  };
  const teamId = createTeamPayload.team.id;
  assert.equal(createTeamPayload.team.teamLeadId, context.tech1Id);
  assert.equal(createTeamPayload.team.members.length, 1);
  assert.equal(createTeamPayload.team.members[0]?.userId, context.tech1Id);
  assert.equal(createTeamPayload.team.members[0]?.teamRole, 'TEAM_LEAD');
  assert.equal(createTeamPayload.team.members[0]?.status, 'ACTIVE');

  const listTeamsResponse = await request(`/api/sites/${context.siteAId}/teams`, {
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
  });

  assert.equal(listTeamsResponse.status, 200);
  const listTeamsPayload = (await listTeamsResponse.json()) as {
    items: {
      id: string;
      members: { userId: string; status: string }[];
    }[];
  };
  const listedTeam = listTeamsPayload.items.find((item) => item.id === teamId);
  assert.ok(listedTeam);
  assert.equal(listedTeam?.members.length, 1);
  assert.ok(listedTeam?.members.every((member) => member.status === 'ACTIVE'));

  const addMemberResponse = await request(`/api/teams/${teamId}/members`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
    body: {
      userId: context.tech2Id,
      teamRole: 'MEMBER',
    },
  });

  assert.equal(addMemberResponse.status, 201);

  const duplicateMemberResponse = await request(`/api/teams/${teamId}/members`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
    body: {
      userId: context.tech2Id,
      teamRole: 'MEMBER',
    },
  });

  assert.equal(duplicateMemberResponse.status, 409);
  const duplicatePayload = (await duplicateMemberResponse.json()) as ErrorPayload;
  assert.equal(duplicatePayload.code, 'CONFLICT');

  const addThirdMemberResponse = await request(`/api/teams/${teamId}/members`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
    body: {
      userId: context.tech3Id,
      teamRole: 'MEMBER',
    },
  });

  assert.equal(addThirdMemberResponse.status, 201);

  const updateTeamResponse = await request(`/api/teams/${teamId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
    body: {
      name: `${smokeTeamAlphaName} Updated`,
      teamLeadId: context.tech2Id,
      status: 'ACTIVE',
    },
  });

  assert.equal(updateTeamResponse.status, 200);
  const updateTeamPayload = (await updateTeamResponse.json()) as {
    team: {
      teamLeadId: string;
      members: { userId: string; teamRole: string; status: string }[];
    };
  };
  assert.equal(updateTeamPayload.team.teamLeadId, context.tech2Id);
  assert.ok(
    updateTeamPayload.team.members.some(
      (member) => member.userId === context.tech2Id && member.teamRole === 'TEAM_LEAD',
    ),
  );
  assert.ok(
    !updateTeamPayload.team.members.some(
      (member) => member.userId === context.tech1Id && member.teamRole === 'TEAM_LEAD',
    ),
  );

  const oldLeadMembership = await prisma.teamMember.findFirst({
    where: {
      teamId,
      userId: context.tech1Id,
      teamRole: 'TEAM_LEAD',
    },
    orderBy: [{ assignmentDate: 'desc' }, { id: 'desc' }],
    select: {
      status: true,
      endDate: true,
    },
  });

  assert.equal(oldLeadMembership?.status, 'INACTIVE');
  assert.ok(oldLeadMembership?.endDate);

  const deleteMemberResponse = await request(`/api/teams/${teamId}/members/${context.tech3Id}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
  });

  assert.equal(deleteMemberResponse.status, 204);

  const removedMembership = await prisma.teamMember.findFirst({
    where: {
      teamId,
      userId: context.tech3Id,
    },
    orderBy: [{ assignmentDate: 'desc' }, { id: 'desc' }],
    select: {
      status: true,
      endDate: true,
    },
  });

  assert.equal(removedMembership?.status, 'INACTIVE');
  assert.ok(removedMembership?.endDate);

  const updatedTeamsResponse = await request(`/api/sites/${context.siteAId}/teams`, {
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
  });

  assert.equal(updatedTeamsResponse.status, 200);
  const updatedTeamsPayload = (await updatedTeamsResponse.json()) as {
    items: {
      id: string;
      members: { userId: string }[];
    }[];
  };
  const updatedTeam = updatedTeamsPayload.items.find((item) => item.id === teamId);
  assert.ok(updatedTeam);
  assert.ok(!updatedTeam?.members.some((member) => member.userId === context.tech3Id));

  const unassignedResponse = await request(`/api/sites/${context.siteAId}/unassigned-users`, {
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
  });

  assert.equal(unassignedResponse.status, 200);
  const unassignedPayload = (await unassignedResponse.json()) as {
    items: { id: string; email: string }[];
  };
  assert.ok(!unassignedPayload.items.some((item) => item.id === context.tech2Id));
  assert.ok(unassignedPayload.items.some((item) => item.email === smokeUserEmail));

  await prisma.team.delete({
    where: {
      id: teamId,
    },
  });
}

async function testClockInFlows(context: TestContext) {
  const todayLabel = new Date().toISOString().slice(0, 10);
  const departureWithoutArrivalAt = `${todayLabel}T07:30:00.000Z`;
  const outsideRadiusAt = `${todayLabel}T07:45:00.000Z`;
  const arrivalAt = `${todayLabel}T08:00:00.000Z`;
  const duplicateArrivalAt = `${todayLabel}T08:05:00.000Z`;
  const pauseStartAt = `${todayLabel}T08:10:00.000Z`;
  const duplicatePauseStartAt = `${todayLabel}T08:12:00.000Z`;
  const pauseEndAt = `${todayLabel}T08:20:00.000Z`;
  const batchArrivalAt = `${todayLabel}T08:15:00.000Z`;
  const departureAt = `${todayLabel}T17:00:00.000Z`;

  await prisma.report.deleteMany({
    where: {
      siteId: context.siteAId,
      userId: {
        in: [context.tech1Id, context.tech3Id],
      },
    },
  });

  await prisma.clockInRecord.deleteMany({
    where: {
      siteId: context.siteAId,
      userId: {
        in: [context.tech1Id, context.tech3Id],
      },
    },
  });

  const adminLogin = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);
  const forbiddenClockIn = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      type: 'ARRIVAL',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 8.5,
      timestampLocal: arrivalAt,
    },
  });

  assert.equal(forbiddenClockIn.status, 403);
  const forbiddenPayload = (await forbiddenClockIn.json()) as ErrorPayload;
  assert.equal(forbiddenPayload.code, 'PERMISSION_DENIED');

  const tech3Login = await loginWithJar('sup.general@chantierpro.local', originalPasswords.tech3);
  const noOpenSession = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech3Login.payload.accessToken}`,
    },
    body: {
      type: 'DEPARTURE',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 8.5,
      timestampLocal: departureWithoutArrivalAt,
    },
  });

  assert.equal(noOpenSession.status, 400);
  const noOpenSessionPayload = (await noOpenSession.json()) as ErrorPayload;
  assert.equal(noOpenSessionPayload.code, 'NO_OPEN_SESSION');

  const outsideRadius = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech3Login.payload.accessToken}`,
    },
    body: {
      type: 'ARRIVAL',
      latitude: 5.431946,
      longitude: -4.0083,
      accuracy: 15.1,
      timestampLocal: outsideRadiusAt,
    },
  });

  assert.equal(outsideRadius.status, 400);
  const outsideRadiusPayload = (await outsideRadius.json()) as ErrorPayload & {
    record?: { status: string };
  };
  assert.equal(outsideRadiusPayload.code, 'OUTSIDE_RADIUS');
  assert.equal(
    outsideRadiusPayload.message,
    'vous \u00eates \u00e0 8.00 km du chantier (rayon autoris\u00e9 : 2 km)',
  );

  const rejectedRecord = await prisma.clockInRecord.findFirst({
    where: {
      siteId: context.siteAId,
      userId: context.tech3Id,
      status: 'REJECTED',
    },
    orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
    select: {
      accuracy: true,
      distanceToSite: true,
    },
  });

  assert.equal(rejectedRecord?.distanceToSite.toNumber(), 8);
  assert.equal(rejectedRecord?.accuracy?.toNumber(), 15.1);

  await prisma.clockInRecord.deleteMany({
    where: {
      siteId: context.siteAId,
      userId: context.tech3Id,
    },
  });

  const tech1Login = await loginWithJar('superviseur@chantierpro.local', originalPasswords.tech1);
  const validArrival = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      type: 'ARRIVAL',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 12.5,
      timestampLocal: arrivalAt,
      comment: 'Commentaire saisi a la creation.',
    },
  });

  assert.equal(validArrival.status, 201);
  const validArrivalPayload = (await validArrival.json()) as {
    record: {
      id: string;
      status: string;
      accuracy: number | null;
      distanceToSite: number;
      comment: string | null;
    };
  };
  assert.equal(validArrivalPayload.record.status, 'VALID');
  assert.equal(validArrivalPayload.record.accuracy, 12.5);
  assert.equal(validArrivalPayload.record.distanceToSite, 0.15);
  assert.equal(validArrivalPayload.record.comment, 'Commentaire saisi a la creation.');
  const arrivalRecordId = validArrivalPayload.record.id;

  const pauseEndWithoutActive = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      type: 'PAUSE_END',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 11.2,
      timestampLocal: pauseStartAt,
    },
  });

  assert.equal(pauseEndWithoutActive.status, 400);
  const pauseEndWithoutActivePayload = (await pauseEndWithoutActive.json()) as ErrorPayload;
  assert.equal(pauseEndWithoutActivePayload.code, 'NO_ACTIVE_PAUSE');

  const pauseStart = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      type: 'PAUSE_START',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 10.1,
      timestampLocal: pauseStartAt,
    },
  });

  assert.equal(pauseStart.status, 201);

  const duplicatePauseStart = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      type: 'PAUSE_START',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 10.1,
      timestampLocal: duplicatePauseStartAt,
    },
  });

  assert.equal(duplicatePauseStart.status, 400);
  const duplicatePauseStartPayload = (await duplicatePauseStart.json()) as ErrorPayload;
  assert.equal(duplicatePauseStartPayload.code, 'PAUSE_ALREADY_ACTIVE');

  const doubleArrival = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      type: 'ARRIVAL',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 12.5,
      timestampLocal: duplicateArrivalAt,
    },
  });

  assert.equal(doubleArrival.status, 400);
  const doubleArrivalPayload = (await doubleArrival.json()) as ErrorPayload;
  assert.equal(doubleArrivalPayload.code, 'SESSION_ALREADY_OPEN');

  const sessionStatusOpen = await request(
    `/api/sites/${context.siteAId}/clock-in/session-status`,
    {
      headers: {
        Authorization: `Bearer ${tech1Login.payload.accessToken}`,
      },
    },
  );

  assert.equal(sessionStatusOpen.status, 200);
  const sessionStatusOpenPayload = (await sessionStatusOpen.json()) as {
    sessionOpen: boolean;
    arrivalTime: string | null;
    duration: number | null;
    pauseActive: boolean;
    pauseDuration: number;
  };
  assert.equal(sessionStatusOpenPayload.sessionOpen, true);
  assert.equal(sessionStatusOpenPayload.arrivalTime, arrivalAt);
  assert.equal(sessionStatusOpenPayload.pauseActive, true);
  assert.ok(sessionStatusOpenPayload.pauseDuration >= 0);
  assert.ok((sessionStatusOpenPayload.duration ?? 0) >= 0);

  const pauseEnd = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      type: 'PAUSE_END',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 10.2,
      timestampLocal: pauseEndAt,
    },
  });

  assert.equal(pauseEnd.status, 201);

  const sessionStatusAfterPause = await request(
    `/api/sites/${context.siteAId}/clock-in/session-status`,
    {
      headers: {
        Authorization: `Bearer ${tech1Login.payload.accessToken}`,
      },
    },
  );

  assert.equal(sessionStatusAfterPause.status, 200);
  const sessionStatusAfterPausePayload = (await sessionStatusAfterPause.json()) as {
    pauseActive: boolean;
    pauseDuration: number;
  };
  assert.equal(sessionStatusAfterPausePayload.pauseActive, false);
  assert.equal(sessionStatusAfterPausePayload.pauseDuration, 0);

  const commentResponse = await request(`/api/clock-in/${arrivalRecordId}/comment`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      comment: 'Arrivee valide et commentaire de chantier.',
    },
  });

  assert.equal(commentResponse.status, 200);
  const commentPayload = (await commentResponse.json()) as {
    record: { id: string; comment: string | null };
  };
  assert.equal(commentPayload.record.id, arrivalRecordId);
  assert.equal(commentPayload.record.comment, 'Arrivee valide et commentaire de chantier.');

  const foreignCommentResponse = await request(`/api/clock-in/${arrivalRecordId}/comment`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${tech3Login.payload.accessToken}`,
    },
    body: {
      comment: 'Commentaire interdit',
    },
  });

  assert.equal(foreignCommentResponse.status, 403);

  const reportCreateResponse = await request(`/api/sites/${context.siteAId}/reports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      content: 'Rapport de debut de vacation.',
      clockInRecordId: arrivalRecordId,
    },
  });

  assert.equal(reportCreateResponse.status, 201);
  const reportCreatePayload = (await reportCreateResponse.json()) as {
    report: { id: string; userId: string; session: { id: string } };
  };
  const reportId = reportCreatePayload.report.id;
  assert.equal(reportCreatePayload.report.userId, context.tech1Id);
  assert.equal(reportCreatePayload.report.session.id, arrivalRecordId);

  const duplicateReportResponse = await request(`/api/sites/${context.siteAId}/reports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      content: 'Rapport duplique.',
      clockInRecordId: arrivalRecordId,
    },
  });

  assert.equal(duplicateReportResponse.status, 409);

  const techOwnReportsResponse = await request(`/api/sites/${context.siteAId}/reports?page=1`, {
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
  });

  assert.equal(techOwnReportsResponse.status, 200);
  const techOwnReportsPayload = (await techOwnReportsResponse.json()) as {
    items: { id: string; userId: string }[];
    pageSize: number;
  };
  assert.equal(techOwnReportsPayload.pageSize, 15);
  assert.ok(techOwnReportsPayload.items.every((item) => item.userId === context.tech1Id));

  const generalSupervisorReportsResponse = await request(
    `/api/sites/${context.siteAId}/reports?page=1&userId=${context.tech1Id}`,
    {
      headers: {
        Authorization: `Bearer ${tech3Login.payload.accessToken}`,
      },
    },
  );

  assert.equal(generalSupervisorReportsResponse.status, 200);
  const generalSupervisorReportsPayload = (await generalSupervisorReportsResponse.json()) as {
    items: { id: string }[];
  };
  assert.ok(generalSupervisorReportsPayload.items.some((item) => item.id === reportId));

  const reportDetailResponse = await request(`/api/reports/${reportId}`, {
    headers: {
      Authorization: `Bearer ${tech3Login.payload.accessToken}`,
    },
  });

  assert.equal(reportDetailResponse.status, 200);
  const reportDetailPayload = (await reportDetailResponse.json()) as {
    report: { id: string; author: { id: string } };
  };
  assert.equal(reportDetailPayload.report.id, reportId);
  assert.equal(reportDetailPayload.report.author.id, context.tech1Id);

  const nearbyResponse = await request('/api/sites/nearby?lat=5.361349&lng=-4.0083', {
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
  });

  assert.equal(nearbyResponse.status, 200);
  const nearbyPayload = (await nearbyResponse.json()) as {
    sites: { id: string; distance: number }[];
  };
  assert.ok(nearbyPayload.sites.some((site) => site.id === context.siteAId));

  const nearbyOutsideResponse = await request('/api/sites/nearby?lat=0&lng=0', {
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
  });

  assert.equal(nearbyOutsideResponse.status, 200);
  const nearbyOutsidePayload = (await nearbyOutsideResponse.json()) as {
    sites: unknown[];
    message?: string;
  };
  assert.equal(nearbyOutsidePayload.sites.length, 0);
  assert.equal(nearbyOutsidePayload.message, 'OUTSIDE_ALL_SITES');

  const validDeparture = await request(`/api/sites/${context.siteAId}/clock-in`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
    body: {
      type: 'DEPARTURE',
      latitude: 5.361349,
      longitude: -4.0083,
      accuracy: 10.2,
      timestampLocal: departureAt,
    },
  });

  assert.equal(validDeparture.status, 201);

  const sessionStatusClosed = await request(
    `/api/sites/${context.siteAId}/clock-in/session-status`,
    {
      headers: {
        Authorization: `Bearer ${tech1Login.payload.accessToken}`,
      },
    },
  );

  assert.equal(sessionStatusClosed.status, 200);
  const sessionStatusClosedPayload = (await sessionStatusClosed.json()) as {
    sessionOpen: boolean;
    hasOpenSession: boolean;
  };
  assert.equal(sessionStatusClosedPayload.sessionOpen, false);
  assert.equal(sessionStatusClosedPayload.hasOpenSession, false);

  const siteHistory = await request(`/api/sites/${context.siteAId}/clock-in`, {
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
  });

  assert.equal(siteHistory.status, 200);
  const siteHistoryPayload = (await siteHistory.json()) as {
    items: { type: string; status: string; comment: string | null }[];
  };
  assert.ok(siteHistoryPayload.items.some((item) => item.type === 'ARRIVAL'));
  assert.ok(
    siteHistoryPayload.items.some(
      (item) => item.type === 'ARRIVAL' && item.comment === 'Arrivee valide et commentaire de chantier.',
    ),
  );
  assert.ok(siteHistoryPayload.items.some((item) => item.type === 'PAUSE_START'));
  assert.ok(siteHistoryPayload.items.some((item) => item.type === 'PAUSE_END'));
  assert.ok(siteHistoryPayload.items.some((item) => item.type === 'DEPARTURE'));

  const meToday = await request('/api/users/me/clock-in', {
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
  });

  assert.equal(meToday.status, 200);
  const meTodayPayload = (await meToday.json()) as {
    activeSession: { siteId: string } | null;
    items: { siteId: string }[];
  };
  assert.equal(meTodayPayload.activeSession, null);
  assert.ok(meTodayPayload.items.some((item) => item.siteId === context.siteAId));

  const meHistory = await request('/api/users/me/clock-in/history', {
    headers: {
      Authorization: `Bearer ${tech1Login.payload.accessToken}`,
    },
  });

  assert.equal(meHistory.status, 200);
  const meHistoryPayload = (await meHistory.json()) as {
    items: { siteId: string; siteName: string; comment: string | null }[];
  };
  assert.ok(meHistoryPayload.items.some((item) => item.siteId === context.siteAId));
  assert.ok(meHistoryPayload.items.some((item) => item.siteName.length > 0));
  assert.ok(
    meHistoryPayload.items.some(
      (item) => item.siteId === context.siteAId && item.comment === 'Arrivee valide et commentaire de chantier.',
    ),
  );

  const batchResponse = await request('/api/sync/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tech3Login.payload.accessToken}`,
    },
    body: {
      items: [
        {
          siteId: context.siteAId,
          type: 'DEPARTURE',
          latitude: 5.361349,
          longitude: -4.0083,
          accuracy: 8.9,
          timestampLocal: departureWithoutArrivalAt,
        },
        {
          siteId: context.siteAId,
          type: 'ARRIVAL',
          latitude: 5.361349,
          longitude: -4.0083,
          accuracy: 8.9,
          timestampLocal: batchArrivalAt,
        },
        {
          siteId: context.siteAId,
          type: 'PAUSE_START',
          latitude: 5.361349,
          longitude: -4.0083,
          accuracy: 8.9,
          timestampLocal: `${todayLabel}T08:16:00.000Z`,
        },
        {
          siteId: context.siteAId,
          type: 'PAUSE_END',
          latitude: 5.361349,
          longitude: -4.0083,
          accuracy: 8.9,
          timestampLocal: `${todayLabel}T08:17:00.000Z`,
        },
      ],
    },
  });

  assert.equal(batchResponse.status, 200);
  const batchPayload = (await batchResponse.json()) as {
    items: { accepted: boolean; status: string; errorCode?: string }[];
  };
  assert.equal(batchPayload.items[0]?.accepted, false);
  assert.equal(batchPayload.items[0]?.status, 'ANOMALY');
  assert.equal(batchPayload.items[0]?.errorCode, 'NO_OPEN_SESSION');
  assert.equal(batchPayload.items[1]?.accepted, true);
  assert.equal(batchPayload.items[1]?.status, 'VALID');
  assert.equal(batchPayload.items[2]?.accepted, true);
  assert.equal(batchPayload.items[2]?.status, 'VALID');
  assert.equal(batchPayload.items[3]?.accepted, true);
  assert.equal(batchPayload.items[3]?.status, 'VALID');

  const projectManagerLogin = await loginWithJar(
    'manager@chantierpro.local',
    originalPasswords.projectManager,
  );
  const attendanceResponse = await request(`/api/sites/${context.siteAId}/attendance/today`, {
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
  });

  assert.equal(attendanceResponse.status, 200);
  const attendancePayload = (await attendanceResponse.json()) as {
    presentNow: { userId: string }[];
    departedToday: { userId: string }[];
    absent: { userId: string }[];
  };
  assert.ok(attendancePayload.presentNow.some((item) => item.userId === context.tech3Id));
  assert.ok(attendancePayload.departedToday.some((item) => item.userId === context.tech1Id));
  assert.ok(!attendancePayload.absent.some((item) => item.userId === context.tech1Id));
}

async function testRhModule(context: TestContext) {
  const siteB = await prisma.site.findFirst({
    where: {
      projectId: context.projectBId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!siteB) {
    throw new Error('Missing seeded site for project B');
  }

  await prisma.rhExportHistory.deleteMany();
  await prisma.clockInRecord.deleteMany({
    where: {
      userId: {
        in: [context.tech1Id, context.tech2Id],
      },
      siteId: {
        in: [context.siteAId, siteB.id],
      },
    },
  });

  await prisma.clockInRecord.createMany({
    data: [
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'ARRIVAL',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T08:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-10T08:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'PAUSE_START',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T12:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-10T12:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'PAUSE_END',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T12:30:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-10T12:30:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'DEPARTURE',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T17:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-10T17:00:00.000Z'),
      },
      {
        siteId: siteB.id,
        userId: context.tech1Id,
        type: 'ARRIVAL',
        clockInDate: new Date('2026-04-11T00:00:00.000Z'),
        clockInTime: new Date('2026-04-11T08:15:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.1,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-11T08:15:00.000Z'),
      },
      {
        siteId: siteB.id,
        userId: context.tech1Id,
        type: 'DEPARTURE',
        clockInDate: new Date('2026-04-11T00:00:00.000Z'),
        clockInTime: new Date('2026-04-11T12:15:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.1,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-11T12:15:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech2Id,
        type: 'ARRIVAL',
        clockInDate: new Date('2026-04-12T00:00:00.000Z'),
        clockInTime: new Date('2026-04-12T09:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.12,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-12T09:00:00.000Z'),
      },
    ],
  });

  const supervisorLogin = await loginWithJar(
    'superviseur@chantierpro.local',
    originalPasswords.tech1,
  );
  const hrLogin = await loginWithJar('rh@chantierpro.local', 'ChantierPro#2026');

  const forbiddenExport = await request('/api/rh/export', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supervisorLogin.payload.accessToken}`,
    },
    body: {
      format: 'csv',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-30T23:59:59.999Z',
    },
  });

  assert.equal(forbiddenExport.status, 403);

  const monthlyResponse = await request('/api/rh/presences?month=4&year=2026', {
    headers: {
      Authorization: `Bearer ${hrLogin.payload.accessToken}`,
    },
  });

  assert.equal(monthlyResponse.status, 200);
  const monthlyPayload = (await monthlyResponse.json()) as {
    items: {
      userId: string;
      totalHours: number;
      nbSessions: number;
      avgHoursPerDay: number;
      lastSite: string | null;
      incompleteSessions: number;
      totalPauseDuration: number;
    }[];
  };

  const tech1Summary = monthlyPayload.items.find((item) => item.userId === context.tech1Id);
  const tech2Summary = monthlyPayload.items.find((item) => item.userId === context.tech2Id);

  assert.ok(tech1Summary);
  assert.equal(tech1Summary?.totalHours, 12.5);
  assert.equal(tech1Summary?.nbSessions, 2);
  assert.equal(tech1Summary?.avgHoursPerDay, 6.25);
  assert.equal(tech1Summary?.lastSite, siteB.name);
  assert.equal(tech1Summary?.totalPauseDuration, 0.5);
  assert.ok(tech2Summary);
  assert.equal(tech2Summary?.incompleteSessions, 1);
  assert.equal(tech2Summary?.nbSessions, 0);

  const filteredMonthlyResponse = await request(
    `/api/rh/presences?month=4&year=2026&projectId=${context.projectAId}`,
    {
      headers: {
        Authorization: `Bearer ${hrLogin.payload.accessToken}`,
      },
    },
  );

  assert.equal(filteredMonthlyResponse.status, 200);
  const filteredMonthlyPayload = (await filteredMonthlyResponse.json()) as {
    items: { userId: string; totalHours: number }[];
  };
  const filteredTech1 = filteredMonthlyPayload.items.find((item) => item.userId === context.tech1Id);
  assert.equal(filteredTech1?.totalHours, 8.5);

  const tech1DetailResponse = await request(
    `/api/rh/presences/${context.tech1Id}?month=4&year=2026&projectId=${context.projectAId}`,
    {
      headers: {
        Authorization: `Bearer ${hrLogin.payload.accessToken}`,
      },
    },
  );

  assert.equal(tech1DetailResponse.status, 200);
  const tech1DetailPayload = (await tech1DetailResponse.json()) as {
    sessions: {
      realDurationHours: number | null;
      pauseDurationHours: number;
      status: string;
      incomplete: boolean;
    }[];
  };
  assert.equal(tech1DetailPayload.sessions.length, 1);
  assert.equal(tech1DetailPayload.sessions[0]?.realDurationHours, 8.5);
  assert.equal(tech1DetailPayload.sessions[0]?.pauseDurationHours, 0.5);
  assert.equal(tech1DetailPayload.sessions[0]?.status, 'VALID');
  assert.equal(tech1DetailPayload.sessions[0]?.incomplete, false);

  const tech2DetailResponse = await request(`/api/rh/presences/${context.tech2Id}?month=4&year=2026`, {
    headers: {
      Authorization: `Bearer ${hrLogin.payload.accessToken}`,
    },
  });

  assert.equal(tech2DetailResponse.status, 200);
  const tech2DetailPayload = (await tech2DetailResponse.json()) as {
    sessions: { status: string; incomplete: boolean; departureTime: string | null }[];
  };
  assert.equal(tech2DetailPayload.sessions[0]?.status, 'INCOMPLETE_SESSION');
  assert.equal(tech2DetailPayload.sessions[0]?.incomplete, true);
  assert.equal(tech2DetailPayload.sessions[0]?.departureTime, null);

  const csvExportResponse = await request('/api/rh/export', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hrLogin.payload.accessToken}`,
    },
    body: {
      format: 'csv',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-30T23:59:59.999Z',
    },
  });

  assert.equal(csvExportResponse.status, 200);
  assert.equal(csvExportResponse.headers.get('content-type'), 'text/csv; charset=utf-8');
  const csvText = await csvExportResponse.text();
  assert.ok(csvText.startsWith('\uFEFF'));
  assert.ok(csvText.includes('Nom,Prénom,Email,Chantier,Date,Heure entrée,Heure sortie,Durée réelle (h),Durée pauses (h),Distance (m),Statut'));
  assert.ok(csvText.includes('TOTAL EMPLOYE'));
  assert.ok(csvText.includes('TOTAL GENERAL'));

  const xlsxExportResponse = await request('/api/rh/export', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${hrLogin.payload.accessToken}`,
    },
    body: {
      format: 'xlsx',
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-04-30T23:59:59.999Z',
      projectId: context.projectAId,
    },
  });

  assert.equal(xlsxExportResponse.status, 200);
  assert.equal(
    xlsxExportResponse.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  const workbook = new ExcelJS.Workbook();
  const xlsxBuffer = Buffer.from(await xlsxExportResponse.arrayBuffer());
  await workbook.xlsx.load(xlsxBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.getWorksheet('Presences RH');
  assert.ok(worksheet);
  assert.equal(worksheet?.getRow(1).font?.bold, true);
  assert.ok((worksheet?.columns[0]?.width ?? 0) > 0);
  assert.equal(worksheet?.getRow(2).getCell(1).value, 'Kouame');

  const historyResponse = await request('/api/rh/exports/history', {
    headers: {
      Authorization: `Bearer ${hrLogin.payload.accessToken}`,
    },
  });

  assert.equal(historyResponse.status, 200);
  const historyPayload = (await historyResponse.json()) as {
    items: { format: string; rowCount: number }[];
  };
  assert.ok(historyPayload.items.length >= 2);
  assert.equal(historyPayload.items[0]?.format, 'xlsx');
  assert.ok(historyPayload.items.some((item) => item.format === 'csv' && item.rowCount === 3));
}

async function testPhotoFlows(context: TestContext) {
  await prisma.photoDeletionLog.deleteMany({
    where: {
      photo: {
        siteId: context.siteAId,
        description: {
          startsWith: smokePhotoDescriptionPrefix,
        },
      },
    },
  });

  await prisma.photo.deleteMany({
    where: {
      siteId: context.siteAId,
      description: {
        startsWith: smokePhotoDescriptionPrefix,
      },
    },
  });

  const supervisorLogin = await loginWithJar(
    'superviseur@chantierpro.local',
    originalPasswords.tech1,
  );
  const coordinatorLogin = await loginWithJar(
    'coordinateur@chantierpro.local',
    originalPasswords.tech2,
  );
  const projectManagerLogin = await loginWithJar(
    'manager@chantierpro.local',
    originalPasswords.projectManager,
  );
  const directionLogin = await loginWithJar(
    'direction@chantierpro.local',
    originalPasswords.direction,
  );
  const adminLogin = await loginWithJar('admin@chantierpro.local', originalPasswords.admin);

  const oversizedUpload = await request('/api/photos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supervisorLogin.payload.accessToken}`,
    },
    formData: createPhotoFormData({
      siteId: context.siteAId,
      category: 'OTHER',
      description: `${smokePhotoDescriptionPrefix} too-large`,
      timestampLocal: new Date().toISOString(),
      file: new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'too-large.jpg', {
        type: 'image/jpeg',
      }),
    }),
  });

  assert.equal(oversizedUpload.status, 413);

  const compressibleFile = await createLargeCompressiblePhotoFile();
  assert.ok(compressibleFile.size > 5 * 1024 * 1024);
  assert.ok(compressibleFile.size < 10 * 1024 * 1024);

  const supervisorUpload = await request('/api/photos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supervisorLogin.payload.accessToken}`,
    },
    formData: createPhotoFormData({
      siteId: context.siteAId,
      category: 'PROGRESS',
      description: `${smokePhotoDescriptionPrefix} supervisor`,
      timestampLocal: new Date().toISOString(),
      lat: 5.361349,
      lng: -4.0083,
      file: compressibleFile,
    }),
  });

  assert.equal(supervisorUpload.status, 201);
  const supervisorUploadPayload = (await supervisorUpload.json()) as {
    photo: {
      id: string;
      fileSize: number;
      uploadedById: string;
      url: string | null;
      description: string;
      category: string;
    };
  };
  const supervisorPhotoId = supervisorUploadPayload.photo.id;
  assert.equal(supervisorUploadPayload.photo.uploadedById, context.tech1Id);
  assert.equal(supervisorUploadPayload.photo.category, 'PROGRESS');
  assert.ok(supervisorUploadPayload.photo.url);
  assert.ok(!JSON.stringify(supervisorUploadPayload).includes('storageKey'));
  assert.ok(supervisorUploadPayload.photo.fileSize < compressibleFile.size);

  const projectManagerUpload = await request('/api/photos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
    formData: createPhotoFormData({
      siteId: context.siteAId,
      category: 'INCIDENT',
      description: `${smokePhotoDescriptionPrefix} manager`,
      timestampLocal: new Date().toISOString(),
      file: createSmallPhotoFile('pm-photo.png'),
    }),
  });

  assert.equal(projectManagerUpload.status, 201);
  const projectManagerUploadPayload = (await projectManagerUpload.json()) as {
    photo: {
      id: string;
      uploadedById: string;
      url: string | null;
    };
  };
  const projectManagerPhotoId = projectManagerUploadPayload.photo.id;
  assert.equal(projectManagerUploadPayload.photo.uploadedById, context.projectManagerId);
  assert.ok(projectManagerUploadPayload.photo.url);

  const supervisorOwnPhoto = await request(`/api/photos/${supervisorPhotoId}`, {
    headers: {
      Authorization: `Bearer ${supervisorLogin.payload.accessToken}`,
    },
  });

  assert.equal(supervisorOwnPhoto.status, 200);
  const supervisorOwnPhotoPayload = (await supervisorOwnPhoto.json()) as {
    photo: { id: string; url: string | null };
  };
  assert.equal(supervisorOwnPhotoPayload.photo.id, supervisorPhotoId);
  assert.ok(supervisorOwnPhotoPayload.photo.url);
  assert.ok(!JSON.stringify(supervisorOwnPhotoPayload).includes('storageKey'));

  const supervisorForeignPhoto = await request(`/api/photos/${projectManagerPhotoId}`, {
    headers: {
      Authorization: `Bearer ${supervisorLogin.payload.accessToken}`,
    },
  });

  assert.equal(supervisorForeignPhoto.status, 404);

  const coordinatorPhotoView = await request(`/api/photos/${projectManagerPhotoId}`, {
    headers: {
      Authorization: `Bearer ${coordinatorLogin.payload.accessToken}`,
    },
  });

  assert.equal(coordinatorPhotoView.status, 200);
  const coordinatorPhotoViewPayload = (await coordinatorPhotoView.json()) as {
    photo: { id: string; url: string | null };
  };
  assert.equal(coordinatorPhotoViewPayload.photo.id, projectManagerPhotoId);
  assert.ok(coordinatorPhotoViewPayload.photo.url);

  const signedUrl = coordinatorPhotoViewPayload.photo.url ?? '';
  assert.ok(signedUrl.length > 0);
  assert.ok(
    signedUrl.includes('X-Amz-Expires=900') ||
      signedUrl.includes('expires='),
    'Signed URL should expose a 15 minute expiration marker.',
  );

  const supervisorListResponse = await request(`/api/sites/${context.siteAId}/photos?page=1`, {
    headers: {
      Authorization: `Bearer ${supervisorLogin.payload.accessToken}`,
    },
  });

  assert.equal(supervisorListResponse.status, 200);
  const supervisorListPayload = (await supervisorListResponse.json()) as {
    items: { id: string; uploadedById: string; url: string | null }[];
    pageSize: number;
  };
  assert.equal(supervisorListPayload.pageSize, 20);
  assert.ok(supervisorListPayload.items.every((item) => item.uploadedById === context.tech1Id));
  assert.ok(supervisorListPayload.items.some((item) => item.id === supervisorPhotoId));
  assert.ok(supervisorListPayload.items.every((item) => typeof item.url === 'string'));

  const projectManagerListResponse = await request(
    `/api/sites/${context.siteAId}/photos?page=1&from=2026-01-01&to=2026-12-31`,
    {
      headers: {
        Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
      },
    },
  );

  assert.equal(projectManagerListResponse.status, 200);
  const projectManagerListPayload = (await projectManagerListResponse.json()) as {
    items: { id: string }[];
  };
  assert.ok(projectManagerListPayload.items.some((item) => item.id === supervisorPhotoId));
  assert.ok(projectManagerListPayload.items.some((item) => item.id === projectManagerPhotoId));

  const forbiddenDelete = await request(`/api/photos/${supervisorPhotoId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${supervisorLogin.payload.accessToken}`,
    },
    body: {
      reason: 'Suppression interdite pour un superviseur',
    },
  });

  assert.equal(forbiddenDelete.status, 403);

  const deleteByProjectManager = await request(`/api/photos/${supervisorPhotoId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
    body: {
      reason: 'Photo remplacee par une version corrigee.',
    },
  });

  assert.equal(deleteByProjectManager.status, 200);
  const deleteByProjectManagerPayload = (await deleteByProjectManager.json()) as {
    photo: { id: string; isDeleted: boolean; url: string | null };
  };
  assert.equal(deleteByProjectManagerPayload.photo.id, supervisorPhotoId);
  assert.equal(deleteByProjectManagerPayload.photo.isDeleted, true);
  assert.equal(deleteByProjectManagerPayload.photo.url, null);

  const deletionLog = await prisma.photoDeletionLog.findFirst({
    where: {
      photoId: supervisorPhotoId,
    },
    orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      reason: true,
      deletedById: true,
      originalAuthorId: true,
    },
  });

  assert.ok(deletionLog);
  assert.equal(deletionLog?.deletedById, context.projectManagerId);
  assert.equal(deletionLog?.originalAuthorId, context.tech1Id);
  assert.equal(deletionLog?.reason, 'Photo remplacee par une version corrigee.');

  const logsResponse = await request('/api/photos/logs?page=1', {
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
  });

  assert.equal(logsResponse.status, 200);
  const logsPayload = (await logsResponse.json()) as {
    items: { id: string; photoId: string; reason: string }[];
    pageSize: number;
  };
  assert.equal(logsPayload.pageSize, 20);
  assert.ok(logsPayload.items.some((item) => item.photoId === supervisorPhotoId));

  const adminLogsResponse = await request('/api/admin/logs?page=1', {
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
  });

  assert.equal(adminLogsResponse.status, 200);
  const adminLogsPayload = (await adminLogsResponse.json()) as {
    items: {
      photoId: string;
      site: { id: string; name: string };
      deletedBy: { id: string; firstName: string; role: string };
      deletedAt: string;
      reason: string;
      originalAuthor: { id: string; firstName: string };
    }[];
    pageSize: number;
  };
  const adminLogItem = adminLogsPayload.items.find((item) => item.photoId === supervisorPhotoId);
  assert.equal(adminLogsPayload.pageSize, 20);
  assert.ok(adminLogItem);
  assert.equal(adminLogItem?.site.id, context.siteAId);
  assert.ok((adminLogItem?.site.name.length ?? 0) > 0);
  assert.equal(adminLogItem?.deletedBy.id, context.projectManagerId);
  assert.equal(adminLogItem?.deletedBy.role, 'PROJECT_MANAGER');
  assert.equal(adminLogItem?.reason, 'Photo remplacee par une version corrigee.');
  assert.equal(adminLogItem?.originalAuthor.id, context.tech1Id);

  const filteredAdminLogsResponse = await request(
    `/api/admin/logs?page=1&deletedBy=${context.projectManagerId}&from=2026-01-01T00:00:00.000Z&to=2026-12-31T23:59:59.999Z`,
    {
      headers: {
        Authorization: `Bearer ${adminLogin.payload.accessToken}`,
      },
    },
  );

  assert.equal(filteredAdminLogsResponse.status, 200);
  const filteredAdminLogsPayload = (await filteredAdminLogsResponse.json()) as {
    items: { deletedBy: { id: string } }[];
  };
  assert.ok(filteredAdminLogsPayload.items.length >= 1);
  assert.ok(
    filteredAdminLogsPayload.items.every((item) => item.deletedBy.id === context.projectManagerId),
  );

  const directionForbiddenAdminExport = await request('/api/admin/logs/export', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
    body: {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.999Z',
      deletedBy: context.projectManagerId,
    },
  });

  assert.equal(directionForbiddenAdminExport.status, 403);

  const adminLogsExportResponse = await request('/api/admin/logs/export', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
    body: {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.999Z',
      deletedBy: context.projectManagerId,
    },
  });

  assert.equal(adminLogsExportResponse.status, 200);
  assert.equal(adminLogsExportResponse.headers.get('content-type'), 'text/csv; charset=utf-8');
  const adminLogsCsv = await adminLogsExportResponse.text();
  assert.ok(adminLogsCsv.startsWith('\uFEFF'));
  assert.ok(adminLogsCsv.includes('Photo ID,Chantier,Supprime par,Role suppresseur,Date suppression,Motif,Auteur original'));
  assert.ok(adminLogsCsv.includes(supervisorPhotoId));
  assert.ok(adminLogsCsv.includes('Photo remplacee par une version corrigee.'));

  const adminImmutableDelete = await request(`/api/photos/logs/${deletionLog?.id ?? ''}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${adminLogin.payload.accessToken}`,
    },
  });

  assert.equal(adminImmutableDelete.status, 403);

  const hiddenDeletedPhoto = await request(`/api/photos/${supervisorPhotoId}`, {
    headers: {
      Authorization: `Bearer ${projectManagerLogin.payload.accessToken}`,
    },
  });

  assert.equal(hiddenDeletedPhoto.status, 404);
}

async function testDirectionModule(context: TestContext) {
  await prisma.photoDeletionLog.deleteMany({
    where: {
      photo: {
        description: {
          startsWith: smokePhotoDescriptionPrefix,
        },
      },
    },
  });

  await prisma.photo.deleteMany({
    where: {
      description: {
        startsWith: smokePhotoDescriptionPrefix,
      },
    },
  });

  const tempProjectManager = await prisma.user.create({
    data: {
      email: smokePmEmail,
      passwordHash: await hash(originalPasswords.projectManager, 10),
      firstName: 'Nadia',
      lastName: 'SmokePM',
      role: Role.PROJECT_MANAGER,
      contact: '0700000999',
      isActive: true,
      mustChangePassword: false,
    },
  });

  const quietProject = await prisma.project.create({
    data: {
      name: smokeProjectName,
      description: 'Projet temporaire pour la vue Direction.',
      address: 'Zone industrielle test',
      city: 'Abidjan',
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      status: ProjectStatus.IN_PROGRESS,
      projectManagerId: tempProjectManager.id,
      createdById: context.directionId,
    },
  });

  const quietSite = await prisma.site.create({
    data: {
      projectId: quietProject.id,
      name: smokeDirectionSiteName,
      address: 'Zone test sans presence',
      latitude: 5.3821,
      longitude: -4.0215,
      radiusKm: 2,
      description: 'Site actif sans activite recente pour les alertes Direction.',
      status: 'ACTIVE',
      area: 150,
      startDate: new Date('2026-04-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T00:00:00.000Z'),
      siteManagerId: context.projectManagerId,
      createdById: context.directionId,
    },
  });

  await prisma.clockInRecord.deleteMany({
    where: {
      userId: {
        in: [context.tech1Id, context.tech2Id, context.tech3Id],
      },
      site: {
        projectId: {
          in: [context.projectAId, context.projectBId, quietProject.id],
        },
      },
    },
  });

  await prisma.photo.createMany({
    data: [
      {
        siteId: context.siteAId,
        uploadedById: context.projectManagerId,
        category: 'PROGRESS',
        description: `${smokePhotoDescriptionPrefix} direction current`,
        filename: 'direction-current.jpg',
        storageKey: `photos/${context.siteAId}/direction-current-${Date.now()}.jpg`,
        url: 'supabase://private/direction-current.jpg',
        fileSize: 125000,
        format: 'image/jpeg',
        timestampLocal: new Date('2026-04-10T10:00:00.000Z'),
        takenAt: new Date('2026-04-10T10:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        uploadedById: context.projectManagerId,
        category: 'PROGRESS',
        description: `${smokePhotoDescriptionPrefix} direction previous`,
        filename: 'direction-previous.jpg',
        storageKey: `photos/${context.siteAId}/direction-previous-${Date.now()}.jpg`,
        url: 'supabase://private/direction-previous.jpg',
        fileSize: 118000,
        format: 'image/jpeg',
        timestampLocal: new Date('2026-03-18T09:00:00.000Z'),
        takenAt: new Date('2026-03-18T09:00:00.000Z'),
      },
    ],
  });

  await prisma.clockInRecord.createMany({
    data: [
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'ARRIVAL',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T08:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: 'Session Direction avril',
        timestampLocal: new Date('2026-04-10T08:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'PAUSE_START',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T12:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-10T12:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'PAUSE_END',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T12:30:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-10T12:30:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'DEPARTURE',
        clockInDate: new Date('2026-04-10T00:00:00.000Z'),
        clockInTime: new Date('2026-04-10T17:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.15,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-10T17:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'ARRIVAL',
        clockInDate: new Date('2026-03-18T00:00:00.000Z'),
        clockInTime: new Date('2026-03-18T08:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.2,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-03-18T08:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech1Id,
        type: 'DEPARTURE',
        clockInDate: new Date('2026-03-18T00:00:00.000Z'),
        clockInTime: new Date('2026-03-18T16:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.2,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-03-18T16:00:00.000Z'),
      },
      {
        siteId: context.siteAId,
        userId: context.tech2Id,
        type: 'ARRIVAL',
        clockInDate: new Date('2026-04-25T00:00:00.000Z'),
        clockInTime: new Date('2026-04-25T07:00:00.000Z'),
        latitude: 5.361349,
        longitude: -4.0083,
        accuracy: 10,
        distanceToSite: 0.18,
        status: 'VALID',
        comment: null,
        timestampLocal: new Date('2026-04-25T07:00:00.000Z'),
      },
    ],
  });

  const hrLogin = await loginWithJar('rh@chantierpro.local', 'ChantierPro#2026');
  const directionLogin = await loginWithJar(
    'direction@chantierpro.local',
    originalPasswords.direction,
  );

  const forbiddenKpis = await request('/api/direction/kpis?month=4&year=2026', {
    headers: {
      Authorization: `Bearer ${hrLogin.payload.accessToken}`,
    },
  });

  assert.equal(forbiddenKpis.status, 403);

  const kpisResponse = await request('/api/direction/kpis?month=4&year=2026', {
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
  });

  assert.equal(kpisResponse.status, 200);
  const kpisPayload = (await kpisResponse.json()) as {
    projects: { inProgress: number; completed: number; onHold: number };
    presences: { currentMonth: number; previousMonth: number; deltaPercent: number | null };
    photos: { currentMonth: number; previousMonth: number; deltaPercent: number | null };
  };
  assert.ok(kpisPayload.projects.inProgress >= 2);
  assert.equal(kpisPayload.projects.onHold, 1);
  assert.equal(kpisPayload.presences.currentMonth, 1);
  assert.equal(kpisPayload.presences.previousMonth, 1);
  assert.equal(kpisPayload.presences.deltaPercent, 0);
  assert.equal(kpisPayload.photos.currentMonth, 1);
  assert.equal(kpisPayload.photos.previousMonth, 1);
  assert.equal(kpisPayload.photos.deltaPercent, 0);

  const consolidatedResponse = await request(
    '/api/direction/projects/consolidated?month=4&year=2026',
    {
      headers: {
        Authorization: `Bearer ${directionLogin.payload.accessToken}`,
      },
    },
  );

  assert.equal(consolidatedResponse.status, 200);
  const consolidatedPayload = (await consolidatedResponse.json()) as {
    items: {
      projectId: string;
      projectStatus: string;
      projectManager: { id: string };
      sitesCount: number;
      resourcesCount: number;
      hoursMonth: number;
      photosMonth: number;
      alertsCount: number;
    }[];
  };
  assert.ok(consolidatedPayload.items.some((item) => item.projectId === context.projectAId));
  assert.ok(consolidatedPayload.items.some((item) => item.projectId === context.projectBId));
  assert.ok(consolidatedPayload.items.some((item) => item.projectId === quietProject.id));

  const projectAConsolidated = consolidatedPayload.items.find(
    (item) => item.projectId === context.projectAId,
  );
  assert.equal(projectAConsolidated?.resourcesCount, 2);
  assert.equal(projectAConsolidated?.hoursMonth, 8.5);
  assert.equal(projectAConsolidated?.photosMonth, 1);
  assert.ok((projectAConsolidated?.alertsCount ?? 0) >= 1);

  const statusFilteredResponse = await request(
    '/api/direction/projects/consolidated?month=4&year=2026&status=IN_PROGRESS',
    {
      headers: {
        Authorization: `Bearer ${directionLogin.payload.accessToken}`,
      },
    },
  );

  assert.equal(statusFilteredResponse.status, 200);
  const statusFilteredPayload = (await statusFilteredResponse.json()) as {
    items: { projectStatus: string; projectId: string }[];
  };
  assert.ok(statusFilteredPayload.items.length >= 2);
  assert.ok(statusFilteredPayload.items.every((item) => item.projectStatus === 'IN_PROGRESS'));
  assert.ok(!statusFilteredPayload.items.some((item) => item.projectId === context.projectBId));

  const pmFilteredResponse = await request(
    `/api/direction/projects/consolidated?month=4&year=2026&projectManager=${tempProjectManager.id}`,
    {
      headers: {
        Authorization: `Bearer ${directionLogin.payload.accessToken}`,
      },
    },
  );

  assert.equal(pmFilteredResponse.status, 200);
  const pmFilteredPayload = (await pmFilteredResponse.json()) as {
    items: { projectId: string; projectManager: { id: string } }[];
  };
  assert.equal(pmFilteredPayload.items.length, 1);
  assert.equal(pmFilteredPayload.items[0]?.projectId, quietProject.id);
  assert.equal(pmFilteredPayload.items[0]?.projectManager.id, tempProjectManager.id);

  const activeSitesResponse = await request('/api/direction/sites/active', {
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
  });

  assert.equal(activeSitesResponse.status, 200);
  const activeSitesPayload = (await activeSitesResponse.json()) as {
    items: { id: string; latitude: number; longitude: number }[];
  };
  assert.ok(activeSitesPayload.items.some((item) => item.id === context.siteAId));
  assert.ok(activeSitesPayload.items.some((item) => item.id === quietSite.id));
  assert.ok(activeSitesPayload.items.every((item) => Number.isFinite(item.latitude)));
  assert.ok(activeSitesPayload.items.every((item) => Number.isFinite(item.longitude)));

  const alertsResponse = await request('/api/direction/alerts', {
    headers: {
      Authorization: `Bearer ${directionLogin.payload.accessToken}`,
    },
  });

  assert.equal(alertsResponse.status, 200);
  const alertsPayload = (await alertsResponse.json()) as {
    sitesWithoutPresence: { siteId: string }[];
    incompleteSessions: { userId: string; hoursOpen: number }[];
    absentResources: { userId: string; workingDaysAbsent: number }[];
  };
  assert.ok(alertsPayload.sitesWithoutPresence.some((item) => item.siteId === quietSite.id));
  assert.ok(
    alertsPayload.incompleteSessions.some(
      (item) => item.userId === context.tech2Id && item.hoursOpen > 12,
    ),
  );
  assert.ok(
    alertsPayload.absentResources.some(
      (item) => item.userId === context.tech3Id && item.workingDaysAbsent > 2,
    ),
  );
}

async function testMiddlewareRoutes() {
  const noCookieResponse = await request('/web/admin', {
    redirect: 'manual',
  });

  assert.ok(isRedirect(noCookieResponse.status));
  assert.equal(noCookieResponse.headers.get('location'), '/login');

  const loginPageResponse = await request('/login', {
    redirect: 'manual',
  });
  assert.ok(isRedirect(loginPageResponse.status));
  assert.equal(loginPageResponse.headers.get('location'), '/web/login');

  const technicianLogin = await loginWithJar('superviseur@chantierpro.local', originalPasswords.tech1);
  const forbiddenResponse = await request('/web/admin', {
    redirect: 'manual',
    cookieJar: technicianLogin.jar,
  });

  assert.ok(isRedirect(forbiddenResponse.status));
  assert.equal(forbiddenResponse.headers.get('location'), '/403');

  const managerLogin = await loginWithJar(
    'manager@chantierpro.local',
    originalPasswords.projectManager,
  );
  const authorizedResponse = await request('/web/project_manager', {
    redirect: 'manual',
    cookieJar: managerLogin.jar,
  });

  assert.equal(authorizedResponse.status, 200);
}

async function testAuthFetchHelper() {
  const authModule = await import('@/lib/auth/client-session');
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

  try {
    authModule.setAccessToken('expired-token');

    const firstCalls: {
      input: RequestInfo | URL;
      init: RequestInit | undefined;
    }[] = [];

    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      firstCalls.push({ input, init });

      if (firstCalls.length === 1) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }

      if (firstCalls.length === 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ accessToken: 'fresh-token' }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        }),
      );
    };

    const retriedResponse = await authModule.authFetch('/api/protected', {
      method: 'GET',
    });

    assert.equal(retriedResponse.status, 200);
    assert.equal(firstCalls.length, 3);

    const retriedHeaders = new Headers(firstCalls[2]?.init?.headers);
    assert.equal(retriedHeaders.get('Authorization'), 'Bearer fresh-token');
    assert.equal(authModule.getAccessToken(), 'fresh-token');

    const secondCalls: {
      input: RequestInfo | URL;
      init: RequestInit | undefined;
    }[] = [];

    const fakeWindow = {
      location: {
        href: '',
      },
    };

    globalThis.window = fakeWindow as unknown as Window & typeof globalThis;
    authModule.setAccessToken('expired-again');

    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      secondCalls.push({ input, init });

      if (secondCalls.length === 1) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }

      if (secondCalls.length === 2) {
        return Promise.resolve(new Response(null, { status: 401 }));
      }

      return Promise.reject(
        new Error('The original request should not be retried after refresh failure'),
      );
    };

    const failedResponse = await authModule.authFetch('/api/protected', {
      method: 'GET',
    });

    assert.equal(failedResponse.status, 401);
    assert.equal(secondCalls.length, 2);
    assert.equal(authModule.getAccessToken(), null);
    assert.equal(fakeWindow.location.href, '/login');
  } finally {
    authModule.clearAccessToken();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
}

async function loginWithJar(email: string, password: string) {
  await prisma.loginAttempt.deleteMany({
    where: {
      emailOrKey: email,
    },
  });

  const jar = createCookieJar();
  const response = await request('/api/auth/login', {
    method: 'POST',
    cookieJar: jar,
    body: {
      email,
      password,
    },
  });

  assert.equal(response.status, 200, `Login failed for ${email}`);

  const payload = (await response.json()) as LoginPayload;
  return {
    jar,
    payload,
  };
}

function createCookieJar(): CookieJar {
  return new Map<string, string>();
}

async function request(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    formData?: FormData;
    cookieJar?: CookieJar;
    redirect?: RequestRedirect;
  } = {},
) {
  const headers = new Headers(options.headers);

  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  if (options.cookieJar && options.cookieJar.size > 0) {
    headers.set('cookie', serializeCookieJar(options.cookieJar));
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body:
      options.formData ??
      (options.body !== undefined ? JSON.stringify(options.body) : null),
    redirect: options.redirect ?? 'follow',
    signal: AbortSignal.timeout(30_000),
  });

  if (options.cookieJar) {
    storeCookiesFromResponse(options.cookieJar, response);
  }

  return response;
}

function serializeCookieJar(cookieJar: CookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function storeCookiesFromResponse(cookieJar: CookieJar, response: Response) {
  const setCookies = response.headers.getSetCookie();

  for (const cookie of setCookies) {
    const [pair] = cookie.split(';');
    if (!pair) {
      continue;
    }
    const [name, value] = pair.split('=');

    if (!name) {
      continue;
    }

    if (!value || cookie.includes('Max-Age=0') || cookie.includes('Expires=Thu, 01 Jan 1970')) {
      cookieJar.delete(name);
      continue;
    }

    cookieJar.set(name, value);
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createPhotoFormData(payload: {
  siteId: string;
  category: string;
  description: string;
  timestampLocal: string;
  file: File;
  lat?: number;
  lng?: number;
}) {
  const formData = new FormData();
  formData.set('siteId', payload.siteId);
  formData.set('category', payload.category);
  formData.set('description', payload.description);
  formData.set('timestampLocal', payload.timestampLocal);
  formData.set('file', payload.file);

  if (typeof payload.lat === 'number') {
    formData.set('lat', String(payload.lat));
  }

  if (typeof payload.lng === 'number') {
    formData.set('lng', String(payload.lng));
  }

  return formData;
}

function createSmallPhotoFile(filename: string) {
  return new File(
    [
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9VE3dCYAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
    filename,
    {
      type: 'image/png',
    },
  );
}

async function createLargeCompressiblePhotoFile() {
  let width = 2200;
  let height = 2200;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pixels = Buffer.alloc(width * height * 3);

    for (let index = 0; index < pixels.length; index += 1) {
      pixels[index] = (index * 31 + attempt * 17) % 256;
    }

    const buffer = await sharp(pixels, {
      raw: {
        width,
        height,
        channels: 3,
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    if (buffer.byteLength > 5 * 1024 * 1024 && buffer.byteLength < 10 * 1024 * 1024) {
      return new File([Uint8Array.from(buffer)], 'large-photo.jpg', {
        type: 'image/jpeg',
      });
    }

    width += 250;
    height += 250;
  }

  throw new Error('Unable to generate a valid 5-10 Mo photo fixture');
}

function isRedirect(status: number) {
  return status === 307 || status === 308 || status === 302 || status === 301;
}

function printSummary() {
  console.log('\nAuth smoke test summary');

  for (const result of results) {
    if (result.status === 'passed') {
      console.log(`[PASS] ${result.name}`);
      continue;
    }

    console.log(`[FAIL] ${result.name}`);
    console.log(`       ${result.detail ?? 'Unknown failure'}`);
  }
}

void main();

