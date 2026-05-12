# 1-c) Règles de Gestion (Business Rules) de Chantier Pro

## BR-01 : Authentification & Sessions
1. L'authentification se fait via email et mot de passe avec émission d'un token JWT.
2. Sur mobile, un refresh token permet de maintenir la session active pendant 30 jours (configurable).
3. Tout changement de rôle ou désactivation de compte par l'Admin doit invalider les tokens actifs immédiatement.

## BR-02 : Géofencing & Pointage
1. Un technicien ne peut pointer (ENTRÉE ou SORTIE) que s'il est situé dans un rayon inférieur ou égal à 2 km des coordonnées GPS du chantier assigné.
2. La distance est calculée côté serveur (formule de Haversine) à partir des coordonnées transmises par le mobile.
3. Si le technicien est hors zone, le pointage est rejeté avec indication de la distance actuelle au chantier.
4. Un pointage de SORTIE doit être rattaché à un pointage d'ENTRÉE précédent non clôturé.

## BR-03 : Documentation Photo
1. La prise de photo doit être instantanée depuis l'appareil photo de l'application (pas de sélection en galerie).
2. Chaque photo doit obligatoirement être horodatée (UTC) et géolocalisée au moment de la capture.
3. Les techniciens n'ont aucun droit de suppression sur les photos qu'ils ont prises ou sur celles des autres.
4. Toute suppression de photo par un utilisateur autorisé (Chef de Projet, Direction, Admin) doit générer une entrée dans le log `PhotoDeletionLog` avec l'ID de l'auteur, la date et le motif.

## BR-04 : Projets & Chantiers
1. Un chantier appartient obligatoirement à un projet unique.
2. Un technicien doit être assigné à un projet pour pouvoir pointer sur les chantiers rattachés à ce projet.
3. Les dates de début et de fin de projet sont indicatives mais n'empêchent pas le pointage (sauf si configuré autrement).

## BR-05 : RH & Exports
1. Le calcul des heures mensuelles se base sur la somme des durées entre chaque paire ENTRÉE/SORTIE valide.
2. Les exports CSV/Excel doivent inclure : Nom Employé, Projet, Chantier, Date, Heure Arrivée, Heure Départ, Durée, Distance au site.
3. Seuls les rôles RH, Direction et Admin ont accès aux exports globaux.

## BR-06 : Intégrité des Données
1. Les logs de suppression sont immuables (pas de modification ni de suppression possible, même par l'Admin).
2. Les données de géolocalisation précises ne sont stockées que pour les événements de pointage et de prise de photo (conformité RGPD).
