import { hash } from 'bcrypt';
import {
  PrismaClient,
  ProjectStatus,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamRole,
  TeamStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

function atUtc(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

async function main() {
  await prisma.loginAttempt.deleteMany();
  await prisma.pushToken.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.rhExportHistory.deleteMany();
  await prisma.photoDeletionLog.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.clockInRecord.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.site.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const sharedPasswordHash = await hash('ChantierPro#2026', 10);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@chantierpro.local' },
      update: {
        firstName: 'Awa',
        lastName: 'Admin',
        role: Role.ADMIN,
        contact: '0700000000',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
      create: {
        email: 'admin@chantierpro.local',
        firstName: 'Awa',
        lastName: 'Admin',
        role: Role.ADMIN,
        contact: '0700000000',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'manager@chantierpro.local' },
      update: {
        firstName: 'Moussa',
        lastName: 'Diallo',
        role: Role.PROJECT_MANAGER,
        contact: '0700000001',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
      create: {
        email: 'manager@chantierpro.local',
        firstName: 'Moussa',
        lastName: 'Diallo',
        role: Role.PROJECT_MANAGER,
        contact: '0700000001',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'rh@chantierpro.local' },
      update: {
        firstName: 'Fatou',
        lastName: 'Bamba',
        role: Role.HR,
        contact: '0700000002',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
      create: {
        email: 'rh@chantierpro.local',
        firstName: 'Fatou',
        lastName: 'Bamba',
        role: Role.HR,
        contact: '0700000002',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'direction@chantierpro.local' },
      update: {
        firstName: 'Aya',
        lastName: 'Konan',
        role: Role.DIRECTION,
        contact: '0700000003',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
      create: {
        email: 'direction@chantierpro.local',
        firstName: 'Aya',
        lastName: 'Konan',
        role: Role.DIRECTION,
        contact: '0700000003',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'superviseur@chantierpro.local' },
      update: {
        firstName: 'Jean',
        lastName: 'Kouame',
        role: Role.SUPERVISOR,
        contact: '0700000004',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
      create: {
        email: 'superviseur@chantierpro.local',
        firstName: 'Jean',
        lastName: 'Kouame',
        role: Role.SUPERVISOR,
        contact: '0700000004',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'coordinateur@chantierpro.local' },
      update: {
        firstName: 'Mariam',
        lastName: 'Traore',
        role: Role.COORDINATOR,
        contact: '0700000005',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
      create: {
        email: 'coordinateur@chantierpro.local',
        firstName: 'Mariam',
        lastName: 'Traore',
        role: Role.COORDINATOR,
        contact: '0700000005',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
    }),
    prisma.user.upsert({
      where: { email: 'sup.general@chantierpro.local' },
      update: {
        firstName: 'Yao',
        lastName: 'Nguessan',
        role: Role.GENERAL_SUPERVISOR,
        contact: '0700000006',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
      create: {
        email: 'sup.general@chantierpro.local',
        firstName: 'Yao',
        lastName: 'Nguessan',
        role: Role.GENERAL_SUPERVISOR,
        contact: '0700000006',
        isActive: true,
        mustChangePassword: false,
        passwordHash: sharedPasswordHash,
      },
    }),
  ]);

  const [admin, projectManager, hr, direction, superviseur, coordinateur, supGeneral] = users;

  void hr;
  void direction;

  const projectA = await prisma.project.create({
    data: {
      name: 'Rénovation Plateau',
      description: 'Réhabilitation complète d’un immeuble administratif.',
      address: 'Rue de Lyon',
      city: 'Abidjan',
      startDate: atUtc('2026-01-01'),
      endDate: atUtc('2026-12-31'),
      status: ProjectStatus.IN_PROGRESS,
      projectManagerId: projectManager.id,
      createdById: admin.id,
    },
  });

  const projectB = await prisma.project.create({
    data: {
      name: 'Extension Marcory',
      description: 'Extension et aménagement d’un site logistique.',
      address: 'Boulevard Valery Giscard d’Estaing',
      city: 'Abidjan',
      startDate: atUtc('2026-03-01'),
      endDate: atUtc('2026-11-30'),
      status: ProjectStatus.ON_HOLD,
      projectManagerId: projectManager.id,
      createdById: admin.id,
    },
  });

  const siteA = await prisma.site.create({
    data: {
      projectId: projectA.id,
      name: 'Bâtiment A',
      address: 'Rue de Lyon, Plateau',
      latitude: '5.360000',
      longitude: '-4.008300',
      radiusKm: '2.00',
      description: 'Chantier principal de rénovation intérieure.',
      status: SiteStatus.ACTIVE,
      area: '500.00',
      startDate: atUtc('2026-02-01'),
      endDate: atUtc('2026-10-31'),
      siteManagerId: projectManager.id,
      createdById: admin.id,
    },
  });

  const siteB = await prisma.site.create({
    data: {
      projectId: projectA.id,
      name: 'Bâtiment B',
      address: 'Rue du Commerce, Plateau',
      latitude: '5.359100',
      longitude: '-4.006500',
      radiusKm: '2.50',
      description: 'Zone secondaire dédiée aux façades et finitions.',
      status: SiteStatus.ON_HOLD,
      area: '320.00',
      startDate: atUtc('2026-04-01'),
      endDate: atUtc('2026-09-30'),
      siteManagerId: projectManager.id,
      createdById: admin.id,
    },
  });

  const siteC = await prisma.site.create({
    data: {
      projectId: projectB.id,
      name: 'Dépôt Marcory',
      address: 'Zone 4, Marcory',
      latitude: '5.286500',
      longitude: '-3.971800',
      radiusKm: '2.00',
      description: 'Site d’extension logistique avec zone technique.',
      status: SiteStatus.COMPLETED,
      area: '780.00',
      startDate: atUtc('2026-03-15'),
      endDate: atUtc('2026-08-15'),
      siteManagerId: projectManager.id,
      createdById: admin.id,
    },
  });

  const teamA = await prisma.team.create({
    data: {
      name: 'Équipe Gros Oeuvre',
      siteId: siteA.id,
      teamLeadId: superviseur.id,
      status: TeamStatus.ACTIVE,
      createdById: projectManager.id,
    },
  });

  const teamB = await prisma.team.create({
    data: {
      name: 'Équipe Finitions',
      siteId: siteB.id,
      teamLeadId: coordinateur.id,
      status: TeamStatus.ACTIVE,
      createdById: projectManager.id,
    },
  });

  await prisma.teamMember.createMany({
    data: [
      {
        teamId: teamA.id,
        userId: superviseur.id,
        teamRole: TeamRole.TEAM_LEAD,
        assignmentDate: atUtc('2026-02-01'),
        endDate: null,
        status: TeamMemberStatus.ACTIVE,
        createdById: projectManager.id,
      },
      {
        teamId: teamA.id,
        userId: supGeneral.id,
        teamRole: TeamRole.MEMBER,
        assignmentDate: atUtc('2026-02-03'),
        endDate: null,
        status: TeamMemberStatus.ACTIVE,
        createdById: projectManager.id,
      },
      {
        teamId: teamB.id,
        userId: coordinateur.id,
        teamRole: TeamRole.TEAM_LEAD,
        assignmentDate: atUtc('2026-04-01'),
        endDate: null,
        status: TeamMemberStatus.ACTIVE,
        createdById: projectManager.id,
      },
    ],
  });

  console.log(
    JSON.stringify(
      {
        users: 7,
        projects: 2,
        sites: 3,
        teams: 2,
        seededProjectIds: [projectA.id, projectB.id],
        seededSiteIds: [siteA.id, siteB.id, siteC.id],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
