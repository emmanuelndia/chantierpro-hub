import {
  ClockInStatus,
  ClockInType,
  PrismaClient,
  ProjectStatus,
  ReportStatus,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamRole,
  TeamStatus,
} from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'ChantierPro2024!';

async function seedIvoryCoastData() {
  console.log("Début du seed Côte d'Ivoire...");

  await cleanup();

  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const direction = await createUser(passwordHash, {
    email: 'direction@chantierpro.ci',
    firstName: 'Awa',
    lastName: 'Coulibaly',
    role: Role.DIRECTION,
    contact: '+2250700000000',
  });
  const projectManager = await createUser(passwordHash, {
    email: 'manager@chantierpro.ci',
    firstName: 'Kouame',
    lastName: 'Nguessan',
    role: Role.PROJECT_MANAGER,
    contact: '+2250700000001',
  });
  const generalSupervisor = await createUser(passwordHash, {
    email: 'general.supervisor@chantierpro.ci',
    firstName: 'Mariam',
    lastName: 'Kone',
    role: Role.GENERAL_SUPERVISOR,
    contact: '+2250700000002',
  });
  const supervisors = await Promise.all([
    createUser(passwordHash, {
      email: 'traore.sup@chantierpro.ci',
      firstName: 'Mamadou',
      lastName: 'Traore',
      role: Role.SUPERVISOR,
      contact: '+2250734567890',
    }),
    createUser(passwordHash, {
      email: 'kone.sup@chantierpro.ci',
      firstName: 'Alassane',
      lastName: 'Kone',
      role: Role.SUPERVISOR,
      contact: '+2250745678901',
    }),
  ]);

  const project = await prisma.project.create({
    data: {
      name: 'Construction Centre Commercial Abidjan',
      description: 'Centre commercial moderne à Cocody',
      address: 'Rue du Commerce, Cocody',
      city: 'Abidjan',
      startDate: new Date('2024-01-15'),
      endDate: new Date('2025-12-31'),
      status: ProjectStatus.IN_PROGRESS,
      projectManagerId: projectManager.id,
      createdById: direction.id,
    },
  });

  const sites = await Promise.all([
    prisma.site.create({
      data: {
        projectId: project.id,
        name: 'Site Cocody Centre Commercial',
        address: 'Rue du Commerce, Cocody, Abidjan',
        latitude: 5.3614,
        longitude: -3.9873,
        radiusKm: 0.5,
        description: 'Gros oeuvre et second oeuvre du centre commercial.',
        status: SiteStatus.ACTIVE,
        area: 8500,
        startDate: new Date('2024-01-15'),
        endDate: new Date('2025-12-31'),
        siteManagerId: generalSupervisor.id,
        createdById: projectManager.id,
      },
    }),
    prisma.site.create({
      data: {
        projectId: project.id,
        name: 'Site Plateau Siège Social',
        address: 'Avenue Chardy, Plateau, Abidjan',
        latitude: 5.3274,
        longitude: -4.0251,
        radiusKm: 0.3,
        description: 'Aménagement des bureaux et réseaux techniques.',
        status: SiteStatus.ACTIVE,
        area: 3200,
        startDate: new Date('2024-03-01'),
        endDate: new Date('2024-12-31'),
        siteManagerId: generalSupervisor.id,
        createdById: projectManager.id,
      },
    }),
  ]);

  for (const [index, site] of sites.entries()) {
    const supervisor = supervisors[index % supervisors.length]!;
    const team = await prisma.team.create({
      data: {
        name: `Équipe ${site.name}`,
        siteId: site.id,
        teamLeadId: supervisor.id,
        status: TeamStatus.ACTIVE,
        createdById: generalSupervisor.id,
      },
    });

    await prisma.teamMember.createMany({
      data: [
        {
          teamId: team.id,
          userId: generalSupervisor.id,
          teamRole: TeamRole.MEMBER,
          assignmentDate: new Date('2024-01-15'),
          status: TeamMemberStatus.ACTIVE,
          createdById: generalSupervisor.id,
        },
        {
          teamId: team.id,
          userId: supervisor.id,
          teamRole: TeamRole.TEAM_LEAD,
          assignmentDate: new Date('2024-01-15'),
          status: TeamMemberStatus.ACTIVE,
          createdById: generalSupervisor.id,
        },
      ],
    });

    const arrival = await prisma.clockInRecord.create({
      data: {
        siteId: site.id,
        userId: supervisor.id,
        type: ClockInType.ARRIVAL,
        clockInDate: new Date('2024-08-01'),
        clockInTime: new Date('1970-01-01T07:30:00.000Z'),
        latitude: site.latitude,
        longitude: site.longitude,
        accuracy: 8,
        distanceToSite: 0.03,
        status: ClockInStatus.VALID,
        comment: 'Arrivée chantier',
        timestampLocal: new Date('2024-08-01T07:30:00.000Z'),
      },
    });

    await prisma.report.create({
      data: {
        siteId: site.id,
        userId: supervisor.id,
        clockInRecordId: arrival.id,
        content: generateReportContent(site.name),
        progression: 35 + index * 10,
        blocage: null,
        status: ReportStatus.RECU,
      },
    });
  }

  const userCount = await prisma.user.count();
  const projectCount = await prisma.project.count();
  const siteCount = await prisma.site.count();
  const reportCount = await prisma.report.count();

  console.log('Seed terminé.');
  console.log(`Utilisateurs: ${userCount}`);
  console.log(`Projets: ${projectCount}`);
  console.log(`Chantiers: ${siteCount}`);
  console.log(`Rapports: ${reportCount}`);
}

async function cleanup() {
  await prisma.photoDeletionLog.deleteMany();
  await prisma.photo.deleteMany();
  await prisma.report.deleteMany();
  await prisma.clockInRecord.deleteMany();
  await prisma.planningAssignment.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.team.deleteMany();
  await prisma.site.deleteMany();
  await prisma.project.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.pushToken.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.rhExportHistory.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(
  passwordHash: string,
  data: {
    email: string;
    firstName: string;
    lastName: string;
    role: Role;
    contact: string;
  },
) {
  return prisma.user.create({
    data: {
      ...data,
      passwordHash,
      isActive: true,
      mustChangePassword: false,
    },
  });
}

function generateReportContent(siteName: string) {
  return [
    `Travaux réalisés sur ${siteName}.`,
    'Contrôle des zones de circulation, vérification des stocks et suivi de la progression.',
    'Aucun incident majeur signalé sur la période.',
  ].join('\n');
}

seedIvoryCoastData()
  .catch((error: unknown) => {
    console.error('Erreur lors du seed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
