# 1-d) Exigences Fonctionnelles de Chantier Pro

## FR-01 : Gestion des Comptes & Authentification
1. Connexion par email/mot de passe avec JWT (JSON Web Token).
2. Réinitialisation de mot de passe par email.
3. Gestion des rôles par l'Admin (création, désactivation, changement de rôle).
4. Session persistante sur mobile (refresh token).

## FR-02 : Pointage Géolocalisé (Mobile)
1. Bouton "ENTRÉE" et "SORTIE" sur l'écran d'accueil pour les techniciens.
2. Vérification de la position GPS du mobile par rapport au périmètre du chantier (2 km).
3. Horodatage automatique (UTC + timezone locale) lors du pointage.
4. Calcul automatique de la durée de présence par session.
5. Historique des pointages personnels consultable par le technicien.
6. Message d'erreur explicite en cas de refus géographique (distance au chantier).
7. Vérification géographique côté serveur pour prévenir la fraude.

## FR-03 : Documentation Photographique (Mobile & Web)
1. Capture de photo instantanée depuis l'application mobile (pas d'accès à la galerie).
2. Association automatique de chaque photo à un chantier, un utilisateur, un horodatage et des coordonnées GPS.
3. Stockage sécurisé sur serveur (S3/Cloudflare R2).
4. Galerie photo filtrable par chantier, date et auteur (Web & Mobile).
5. Fonction de suppression de photo réservée aux rôles Chef de Projet, Direction et Admin.
6. Journalisation immuable de chaque suppression (auteur, date, ID photo, raison).

## FR-04 : Gestion de Projets & Chantiers (Web)
1. Création et édition de projets (nom, description, dates).
2. Création et édition de chantiers rattachés à un projet (nom, adresse, latitude, longitude, rayon).
3. Assignation de techniciens à des projets spécifiques.
4. Vue liste et vue détaillée des projets avec indicateurs de présence.
5. Consultation des photos rattachées à un chantier.

## FR-05 : Suivi RH & Reporting (Web)
1. Tableau de bord mensuel affichant le cumul des heures de présence par employé.
2. Vue détaillée des sessions de pointage par employé (chantiers visités, durées).
3. Export des données mensuelles au format CSV ou Excel.
4. Filtres multicritères (mois, employé, projet).

## FR-06 : Vue Direction & Administration (Web)
1. Tableau de bord consolidé multi-projets.
2. Accès complet aux métriques RH et à la documentation photo.
3. Gestion centralisée des utilisateurs et de leurs permissions (Admin).
4. Consultation des logs de suppression de photos pour audit.
