import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Données réalistes pour la Côte d'Ivoire
const ivoryCoastData = {
  coordinateurs: [
    {
      email: 'koordinator@chantierpro.ci',
      firstName: 'Konan',
      lastName: 'Bamba',
      role: 'COORDINATOR',
      phone: '+2250712345678',
    },
    {
      email: 'yao.coordinator@chantierpro.ci',
      firstName: 'Yao',
      lastName: 'Kouadio',
      role: 'COORDINATOR',
      phone: '+2250723456789',
    },
  ],
  superviseurs: [
    {
      email: 'traore.sup@chantierpro.ci',
      firstName: 'Mamadou',
      lastName: 'Traoré',
      role: 'SUPERVISOR',
      phone: '+2250734567890',
    },
    {
      email: 'kone.sup@chantierpro.ci',
      firstName: 'Alassane',
      lastName: 'Koné',
      role: 'SUPERVISOR',
      phone: '+2250745678901',
    },
    {
      email: 'sangare.sup@chantierpro.ci',
      firstName: 'Adama',
      lastName: 'Sangaré',
      role: 'SUPERVISOR',
      phone: '+2250756789012',
    },
    {
      email: 'ouattara.sup@chantierpro.ci',
      firstName: 'Ibrahim',
      lastName: 'Ouattara',
      role: 'SUPERVISOR',
      phone: '+2250767890123',
    },
  ],
  projets: [
    {
      name: 'Construction Centre Commercial Abidjan',
      description: 'Centre commercial moderne à Cocody',
      status: 'ACTIVE',
      startDate: new Date('2024-01-15'),
      endDate: new Date('2025-12-31'),
    },
    {
      name: 'Rénovation Route Yopougon-Plateau',
      description: 'Modernisation infrastructure routière',
      status: 'ACTIVE',
      startDate: new Date('2024-03-01'),
      endDate: new Date('2024-12-31'),
    },
    {
      name: 'Complexes Résidentiels Bondoukou',
      description: 'Ensemble de 200 logements sociaux',
      status: 'ACTIVE',
      startDate: new Date('2024-02-01'),
      endDate: new Date('2025-06-30'),
    },
  ],
  sites: [
    {
      // Abidjan - Cocody (Centre Commercial)
      name: 'Site Cocody Centre Commercial',
      address: 'Rue du Commerce, Cocody, Abidjan',
      latitude: 5.3614,
      longitude: -3.9873,
      radiusKm: 0.5,
      status: 'ACTIVE',
      projectId: 1, // Sera mis à jour après création
      coordinatorId: 1, // Sera mis à jour après création
    },
    {
      // Abidjan - Plateau (Bureau principal)
      name: 'Site Plateau Siège Social',
      address: 'Avenue Chardy, Plateau, Abidjan',
      latitude: 5.3274,
      longitude: -4.0251,
      radiusKm: 0.3,
      status: 'ACTIVE',
      projectId: 2,
      coordinatorId: 1,
    },
    {
      // Yopougon (Zone industrielle)
      name: 'Site Yopougon Industriel',
      address: 'Zone Industrielle, Yopougon, Abidjan',
      latitude: 5.3599,
      longitude: -4.0883,
      radiusKm: 1.0,
      status: 'ACTIVE',
      projectId: 2,
      coordinatorId: 1,
    },
    {
      // Yopougon (Quartier résidentiel)
      name: 'Site Yopougon Résidentiel',
      address: 'Carrefour 200 Logements, Yopougon, Abidjan',
      latitude: 5.3499,
      longitude: -4.0783,
      radiusKm: 0.8,
      status: 'ACTIVE',
      projectId: 2,
      coordinatorId: 2,
    },
    {
      // Bondoukou (Centre-ville)
      name: 'Site Bondoukou Centre',
      address: 'Avenue de la République, Bondoukou',
      latitude: 8.0406,
      longitude: -2.8014,
      radiusKm: 1.5,
      status: 'ACTIVE',
      projectId: 3,
      coordinatorId: 2,
    },
    {
      // Bondoukou (Zone extension)
      name: 'Site Bondoukou Extension',
      address: 'Route de Tanda, Bondoukou',
      latitude: 8.0506,
      longitude: -2.7914,
      radiusKm: 2.0,
      status: 'ACTIVE',
      projectId: 3,
      coordinatorId: 2,
    },
  ],
};

async function seedIvoryCoastData() {
  console.log('🌍 Début du seed des données Côte d\'Ivoire...');

  try {
    // Nettoyage des données existantes
    console.log('🧹 Nettoyage des données existantes...');
    await prisma.activityLog.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.report.deleteMany();
    await prisma.clockInSession.deleteMany();
    await prisma.assignment.deleteMany();
    await prisma.site.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();

    // Création des utilisateurs
    console.log('👥 Création des utilisateurs...');
    const createdUsers = [];

    // Coordinateurs
    for (const coord of ivoryCoastData.coordinateurs) {
      const hashedPassword = await bcrypt.hash('ChantierPro2024!', 10);
      const user = await prisma.user.create({
        data: {
          ...coord,
          password: hashedPassword,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      createdUsers.push({ ...coord, id: user.id, type: 'coordinator' });
      console.log(`✅ Coordinateur créé: ${coord.firstName} ${coord.lastName}`);
    }

    // Superviseurs
    for (const sup of ivoryCoastData.superviseurs) {
      const hashedPassword = await bcrypt.hash('ChantierPro2024!', 10);
      const user = await prisma.user.create({
        data: {
          ...sup,
          password: hashedPassword,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      createdUsers.push({ ...sup, id: user.id, type: 'supervisor' });
      console.log(`✅ Superviseur créé: ${sup.firstName} ${sup.lastName}`);
    }

    // Création des projets
    console.log('🏗️ Création des projets...');
    const createdProjects = [];
    for (const project of ivoryCoastData.projets) {
      const created = await prisma.project.create({
        data: {
          ...project,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      createdProjects.push({ ...project, id: created.id });
      console.log(`✅ Projet créé: ${project.name}`);
    }

    // Mise à jour des IDs dans les sites et création
    console.log('📍 Création des sites...');
    const createdSites = [];
    for (let i = 0; i < ivoryCoastData.sites.length; i++) {
      const site = ivoryCoastData.sites[i];
      const created = await prisma.site.create({
        data: {
          ...site,
          projectId: createdProjects[site.projectId - 1].id,
          coordinatorId: createdUsers.filter(u => u.type === 'coordinator')[site.coordinatorId - 1].id,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      createdSites.push({ ...site, id: created.id });
      console.log(`✅ Site créé: ${site.name}`);
    }

    // Assignation des superviseurs aux sites
    console.log('👷 Assignation des superviseurs aux sites...');
    const assignments = [
      { supervisorId: 2, siteId: 1 }, // Traoré -> Cocody
      { supervisorId: 2, siteId: 2 }, // Traoré -> Plateau
      { supervisorId: 3, siteId: 3 }, // Koné -> Yopougon Industriel
      { supervisorId: 3, siteId: 4 }, // Koné -> Yopougon Résidentiel
      { supervisorId: 4, siteId: 5 }, // Sangaré -> Bondoukou Centre
      { supervisorId: 5, siteId: 6 }, // Ouattara -> Bondoukou Extension
    ];

    const supervisors = createdUsers.filter(u => u.type === 'supervisor');
    for (const assignment of assignments) {
      await prisma.assignment.create({
        data: {
          userId: supervisors[assignment.supervisorId - 2].id, // -2 car superviseurs commencent à l'index 2
          siteId: createdSites[assignment.siteId - 1].id,
          assignedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      console.log(`✅ Assignation: ${supervisors[assignment.supervisorId - 2].firstName} -> ${createdSites[assignment.siteId - 1].name}`);
    }

    // Création de sessions de pointage pour aujourd'hui et les jours précédents
    console.log('⏰ Création de sessions de pointage...');
    const today = new Date();
    today.setHours(7, 0, 0, 0); // 7h du matin

    for (let i = 0; i < 5; i++) { // Sessions pour les 5 derniers jours
      const sessionDate = new Date(today);
      sessionDate.setDate(sessionDate.getDate() - i);

      for (const supervisor of supervisors) {
        // Assignations du superviseur
        const userAssignments = await prisma.assignment.findMany({
          where: { userId: supervisor.id },
          include: { site: true },
        });

        for (const assignment of userAssignments) {
          const arrivalTime = new Date(sessionDate);
          arrivalTime.setHours(7 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60)); // 7-8h

          const departureTime = new Date(arrivalTime);
          departureTime.setHours(16 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60)); // 16-17h

          const session = await prisma.clockInSession.create({
            data: {
              userId: supervisor.id,
              siteId: assignment.siteId,
              date: sessionDate,
              arrivalAt: arrivalTime,
              departureAt: i < 3 ? departureTime : null, // Sessions en cours pour les 2 derniers jours
              durationSeconds: i < 3 ? Math.floor((departureTime.getTime() - arrivalTime.getTime()) / 1000) : null,
              status: 'VALID',
              createdAt: arrivalTime,
              updatedAt: departureTime || new Date(),
            },
          });

          // Création de rapports pour les sessions terminées
          if (i < 3 && Math.random() > 0.3) { // 70% des sessions terminées ont un rapport
            const reportContent = generateReportContent(assignment.site.name, sessionDate);
            
            await prisma.report.create({
              data: {
                authorId: supervisor.id,
                siteId: assignment.siteId,
                content: reportContent,
                status: Math.random() > 0.5 ? 'SUBMITTED' : 'VALIDATED',
                createdAt: departureTime,
                updatedAt: departureTime,
              },
            });

            console.log(`📄 Rapport créé: ${supervisor.firstName} -> ${assignment.site.name}`);
          }

          console.log(`⏰ Session créée: ${supervisor.firstName} -> ${assignment.site.name} (${sessionDate.toLocaleDateString()})`);
        }
      }
    }

    // Création de quelques photos de test
    console.log('📸 Création de photos de test...');
    const reports = await prisma.report.findMany({ take: 10 });
    
    for (const report of reports) {
      for (let i = 0; i < Math.floor(Math.random() * 4) + 1; i++) { // 1-4 photos par rapport
        await prisma.photo.create({
          data: {
            filename: `photo_${report.id}_${i + 1}.jpg`,
            url: `https://picsum.photos/seed/chantier${report.id}${i}/400/300.jpg`,
            siteId: report.siteId,
            authorId: report.authorId,
            reportId: report.id,
            takenAt: new Date(report.createdAt.getTime() + i * 3600000), // Photos espacées d'1h
            description: `Photo ${i + 1} du chantier`,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      }
    }

    console.log('🎉 Seed des données Côte d\'Ivoire terminé avec succès!');
    
    // Résumé des données créées
    const userCount = await prisma.user.count();
    const projectCount = await prisma.project.count();
    const siteCount = await prisma.site.count();
    const sessionCount = await prisma.clockInSession.count();
    const reportCount = await prisma.report.count();
    const photoCount = await prisma.photo.count();

    console.log('\n📊 Résumé des données créées:');
    console.log(`👥 Utilisateurs: ${userCount}`);
    console.log(`🏗️ Projets: ${projectCount}`);
    console.log(`📍 Sites: ${siteCount}`);
    console.log(`⏰ Sessions: ${sessionCount}`);
    console.log(`📄 Rapports: ${reportCount}`);
    console.log(`📸 Photos: ${photoCount}`);

  } catch (error) {
    console.error('❌ Erreur lors du seed:', error);
    throw error;
  }
}

function generateReportContent(siteName: string, date: Date): string {
  const activities = [
    'Excavation des fondations',
    'Coulage du béton',
    'Installation des armatures',
    'Montage des structures',
    'Travaux d\'électricité',
    'Plomberie et sanitaire',
    'Finitions intérieures',
    'Travaux de peinture',
    'Installation des fenêtres',
    'Aménagement extérieur',
  ];

  const issues = [
    'Retard d\'approvisionnement en ciment',
    'Problème d\'accès au chantier',
    'Météo défavorable',
    'Absence de quelques ouvriers',
    'Panne d\'équipement',
  ];

  const nextSteps = [
    'Continuer les fondations',
    'Préparer le prochain coulage',
    'Finaliser les structures',
    'Commencer les finitions',
    'Planifier les inspections',
  ];

  const randomActivity = activities[Math.floor(Math.random() * activities.length)];
  const randomIssue = Math.random() > 0.7 ? issues[Math.floor(Math.random() * issues.length)] : null;
  const randomNextStep = nextSteps[Math.floor(Math.random() * nextSteps.length)];

  let content = `RAPPORT JOURNALIER - ${siteName}\n`;
  content += `Date: ${date.toLocaleDateString('fr-FR')}\n\n`;
  content += `TRAVAUX RÉALISÉS:\n`;
  content += `- ${randomActivity}\n`;
  content += `- Progression générale: ${Math.floor(Math.random() * 30 + 60)}%\n`;
  content += `- Effectif présent: ${Math.floor(Math.random() * 10 + 15)} ouvriers\n\n`;

  if (randomIssue) {
    content += `PROBLÈMES RENCONTRÉS:\n`;
    content += `- ${randomIssue}\n\n`;
  }

  content += `PROCHAINES ÉTAPES:\n`;
  content += `- ${randomNextStep}\n\n`;
  content += `REMARQUES:\n`;
  content += `Bon déroulement général de la journée. Les équipes sont motivées et respectent les délais prévus.\n`;

  return content;
}

// Exécuter le seed
if (require.main === module) {
  seedIvoryCoastData()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

export { seedIvoryCoastData };
