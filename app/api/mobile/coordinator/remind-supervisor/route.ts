import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';

export const POST = withAuth(async ({ user, body }) => {
  if (user.role !== 'COORDINATOR') {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const { supervisorId, reportId } = body as {
    supervisorId: string;
    reportId: string;
  };

  if (!supervisorId || !reportId) {
    return Response.json(
      { code: 'INVALID_REQUEST', message: 'Paramètres manquants' },
      { status: 400 }
    );
  }

  try {
    // Vérifier que le superviseur est bien sous la responsabilité de ce coordinateur
    const coordinatorSite = await prisma.site.findFirst({
      where: {
        coordinatorId: user.id,
        assignments: {
          some: {
            userId: supervisorId,
            user: {
              role: 'SUPERVISOR',
            },
          },
        },
      },
    });

    if (!coordinatorSite) {
      return Response.json(
        { code: 'FORBIDDEN', message: 'Ce superviseur n\'est pas sous votre responsabilité' },
        { status: 403 }
      );
    }

    // Récupérer les informations du superviseur
    const supervisor = await prisma.user.findUnique({
      where: { id: supervisorId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });

    if (!supervisor) {
      return Response.json(
        { code: 'NOT_FOUND', message: 'Superviseur non trouvé' },
        { status: 404 }
      );
    }

    // Créer une notification de rappel
    await prisma.notification.create({
      data: {
        userId: supervisorId,
        title: 'Rappel de rapport',
        message: `Bonjour ${supervisor.firstName}, veuillez soumettre votre rapport de chantier dès que possible.`,
        type: 'REPORT_REMINDER',
        createdAt: new Date(),
        readAt: null,
      },
    });

    // TODO: Envoyer une notification push ici
    // Pour l'instant, nous simulons l'envoi
    
    // Journaliser l'action
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'REMIND_SUPERVISOR',
        targetType: 'USER',
        targetId: supervisorId,
        details: {
          coordinatorName: `${user.firstName} ${user.lastName}`,
          supervisorName: `${supervisor.firstName} ${supervisor.lastName}`,
          reportId,
        },
        createdAt: new Date(),
      },
    });

    return Response.json({ 
      success: true, 
      message: 'Rappel envoyé avec succès' 
    });

  } catch (error) {
    console.error('Remind supervisor error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors de l\'envoi du rappel' },
      { status: 500 }
    );
  }
});
