# 1-b) User Stories de Chantier Pro

## Module 1 — Référentiel Utilisateurs & Authentification
1. En tant qu'utilisateur, je veux me connecter via mon email et mot de passe pour accéder à mes fonctionnalités métier.
2. En tant qu'utilisateur mobile, je veux que ma session soit persistante pour ne pas avoir à me reconnecter chaque matin sur le terrain.
3. En tant qu'administrateur, je veux créer, modifier ou désactiver des comptes utilisateurs pour gérer les arrivées et départs de l'entreprise.
4. En tant qu'administrateur, je veux réinitialiser le mot de passe d'un utilisateur directement depuis l'interface pour débloquer rapidement un accès sans envoyer d'email.
5. En tant qu'administrateur, je veux assigner un rôle précis à chaque utilisateur (Superviseur, Coordinateur, Superviseur Général, Chef de Projet, RH, Direction) pour contrôler les accès de façon granulaire.

## Module 2 — Projets, Chantiers & Équipes
1. En tant que Chef de Projet, je veux créer un projet et y rattacher un ou plusieurs chantiers géolocalisés pour structurer l'activité terrain.
2. En tant que Chef de Projet, je veux créer des équipes sur mes chantiers et y affecter des ressources terrain pour organiser le travail sur le site.
3. En tant que Chef de Projet ou Superviseur Général, je veux pouvoir affecter n'importe quelle ressource terrain active à une équipe, même si cette ressource a été initialement associée à un autre projet, pour gérer la rotation des effectifs.
4. En tant que Direction, je veux consulter la liste de tous les projets et chantiers actifs pour avoir une vue d'ensemble de l'activité.
5. En tant que Chef de Projet ou Direction, je veux configurer le rayon de géofencing de chaque chantier (entre 0.5 et 10 km) pour adapter la validation de présence aux contraintes du site.

## Module 3 — Planning Journalier (Superviseur Général)
1. En tant que Superviseur Général, je veux créer le planning journalier en assignant chaque superviseur à un chantier avec une description de tâche et un objectif de progression pour organiser les activités du jour.
2. En tant que Superviseur Général, je veux dupliquer le planning de la veille comme point de départ pour gagner du temps lors de la planification quotidienne.
3. En tant que Superviseur Général, je veux exporter le planning du jour au format CSV pour le partager avec l'équipe ou le client.
4. En tant que Superviseur Général, je veux voir en temps réel quels superviseurs ont pointé et leur statut (sur site, en pause, absent) pour suivre le déploiement de mes équipes.

## Module 4 — Pointage Géolocalisé
1. En tant que Superviseur, Coordinateur ou Superviseur Général, je veux pointer mon entrée et ma sortie de chantier en un clic pour déclarer mes heures de présence.
2. En tant que ressource terrain, je veux être alerté avec la distance exacte si je suis trop loin du chantier pour comprendre pourquoi mon pointage est refusé.
3. En tant que Superviseur, je veux consulter l'historique de mes pointages et de mes sessions pour vérifier mes heures travaillées.
4. En tant que ressource terrain, je veux déclarer une pause pendant ma session de travail pour que la durée de pause soit déduite de mon temps de présence effectif.
5. En tant que ressource terrain, je veux ajouter un commentaire libre sur un pointage pour signaler un contexte particulier (retard, accès difficile, etc.).
6. En tant que ressource terrain, je veux pouvoir pointer hors ligne (zone sans réseau) et que mes pointages se synchronisent automatiquement au retour du réseau.
7. En tant que Système, je veux valider les coordonnées GPS côté serveur pour empêcher toute falsification de position.
8. En tant que ressource terrain, je veux être détecté automatiquement sur le bon chantier via le GPS (mode rapide) pour pointer sans avoir à sélectionner manuellement mon site.

## Module 5 — Documentation Photographique
1. En tant que ressource terrain (Superviseur, Coordinateur, Superviseur Général, Chef de Projet, Direction), je veux prendre une photo directement depuis l'application pour documenter l'avancement ou un problème sur le chantier.
2. En tant que Superviseur, je veux lier une photo à une tâche assignée dans mon planning pour confirmer visuellement l'accomplissement de cette tâche.
3. En tant que Chef de Projet ou Direction, je veux visualiser toutes les photos d'un chantier, filtrées par date ou par auteur, pour suivre l'état d'avancement sans me déplacer.
4. En tant que Chef de Projet ou Direction, je veux supprimer une photo erronée en indiquant un motif, tout en sachant que cette action est tracée de façon immuable.
5. En tant que Direction ou Admin, je veux consulter les logs de suppression pour m'assurer de l'intégrité de la documentation photographique.
6. En tant que ressource terrain, je veux prendre des photos hors ligne et qu'elles se synchronisent automatiquement au retour du réseau.

## Module 6 — Rapports Terrain
1. En tant que Superviseur, je veux soumettre un rapport de fin de session décrivant les travaux réalisés, ma progression et les éventuels blocages pour informer ma hiérarchie.
2. En tant que Superviseur, je veux consulter l'historique de mes rapports passés et voir leur statut (Reçu, Validé, Envoyé client) pour suivre leur traitement.
3. En tant que Coordinateur, je veux consulter et valider les rapports de mes superviseurs depuis mon mobile ou le web pour les transmettre aux clients.
4. En tant que Coordinateur, Chef de Projet, Superviseur Général ou Direction, je veux télécharger un rapport au format texte pour l'archiver ou le transmettre.
5. En tant que Superviseur Général, je veux comparer la progression déclarée dans les rapports avec les objectifs du planning pour identifier les écarts en temps réel.
6. En tant que Coordinateur, je veux relancer un superviseur qui n'a pas encore soumis son rapport après la fin de sa session pour m'assurer de la complétude de la documentation.

## Module 7 — RH & Suivi des Heures
1. En tant que RH, je veux consulter un tableau de bord mensuel des heures de présence effectives (hors pauses) par employé pour préparer les variables de paie.
2. En tant que RH, je veux exporter les données de présence en format CSV ou Excel pour les intégrer dans mon logiciel de paie.
3. En tant que RH, je veux filtrer les présences par projet, par chantier ou par employé pour analyser la consommation d'heures par affaire.
4. En tant que RH, je veux voir le détail des sessions avec les pauses séparées pour valider la durée de travail effective déclarée.

## Module 8 — Pilotage Direction & Admin
1. En tant que Direction, je veux accéder aux métriques consolidées (heures totales, photos prises, projets actifs, progression par site) pour piloter l'entreprise.
2. En tant que Direction, je veux consulter une carte géographique de tous les chantiers actifs avec les ressources présentes en temps réel.
3. En tant que Direction, je veux recevoir des alertes automatiques sur les sites sans activité depuis plus de 2 jours ou les sessions anormalement longues.
4. En tant qu'Administrateur, je veux gérer les rôles et permissions des utilisateurs pour garantir la sécurité des données.
5. En tant qu'Administrateur, je veux accéder au mobile avec les mêmes fonctionnalités que la Direction, plus la gestion des utilisateurs, pour intervenir depuis le terrain si nécessaire.