# 1-a) Problèmes / Objectifs de Chantier Pro

## Module 1 — Référentiel Utilisateurs & Authentification
1. Centraliser la gestion des utilisateurs et de leurs rôles (Superviseur, Coordinateur, Superviseur Général, Chef de Projet, RH, Direction, Admin).
2. Sécuriser l'accès à l'application via une authentification robuste (JWT avec access token et refresh token).
3. Garantir l'intégrité des sessions sur mobile pour les ressources terrain grâce à une PWA installable depuis le navigateur.
4. Gérer des ressources tournantes pouvant intervenir sur plusieurs projets et chantiers indépendamment de leur affectation initiale.

## Module 2 — Projets, Chantiers & Équipes
1. Structurer le découpage opérationnel entre Projets (entité contractuelle/globale) et Chantiers (entité géographique/exécution).
2. Définir précisément les zones de travail via des coordonnées GPS et un rayon de géofencing configurable par chantier (0.5 à 10 km, défaut 2 km).
3. Organiser les ressources terrain en équipes rattachées à des chantiers, tout en permettant la rotation des ressources entre projets et chefs de projet différents.
4. Permettre à un Superviseur Général de faire le planning journalier : assigner des superviseurs à des chantiers avec une description de tâche et un objectif de progression.

## Module 3 — Pointage Géolocalisé
1. Éliminer la fraude et les erreurs de saisie manuelle des heures de présence en validant la position GPS côté serveur (anti-spoofing).
2. Garantir que le pointage n'est possible que si la ressource est physiquement sur site (rayon configurable par chantier).
3. Automatiser le calcul de la durée de présence effective par session, en déduisant les pauses déclarées.
4. Permettre la déclaration de pauses pendant une session de travail afin de refléter fidèlement le temps de travail réel.
5. Permettre le pointage en mode hors ligne (zone blanche) avec synchronisation automatique au retour du réseau.
6. Permettre à une ressource d'intervenir sur plusieurs chantiers dans la même journée sans blocage applicatif.

## Module 4 — Documentation Photographique
1. Centraliser la documentation visuelle des chantiers pour éviter l'usage de canaux non sécurisés (WhatsApp, galeries personnelles).
2. Conférer une valeur probatoire aux photos via l'horodatage et la géolocalisation immuables au moment de la prise de vue.
3. Permettre à une ressource de lier une photo à une tâche assignée dans le planning pour confirmer visuellement l'avancement d'une activité spécifique.
4. Assurer la pérennité des données en empêchant la suppression par le personnel de terrain (Superviseur).
5. Maintenir une piste d'audit complète pour toute suppression effectuée par l'encadrement (Chef de Projet, Direction, Admin).
6. Stocker les photos dans un bucket privé (Supabase Storage) sans URL publique — chaque accès génère une URL signée temporaire (15 minutes).

## Module 5 — Rapports Terrain
1. Permettre aux ressources terrain (Superviseur, Coordinateur, Superviseur Général) de soumettre un rapport de fin de session décrivant les travaux réalisés, la progression et les éventuels blocages.
2. Permettre au Coordinateur de suivre, valider et télécharger les rapports de ses superviseurs avant envoi aux clients.
3. Permettre au Superviseur Général de comparer la progression réelle déclarée dans les rapports avec les objectifs fixés dans le planning journalier.
4. Assurer la traçabilité des rapports avec un cycle de statuts : Reçu → En revue → Validé → Envoyé client.

## Module 6 — RH & Suivi des Heures
1. Automatiser la consolidation mensuelle des heures de présence effectives (hors pauses) pour la préparation de la paie.
2. Offrir une visibilité granulaire sur les sessions de pointage, les pauses, les chantiers visités et les commentaires associés.
3. Faciliter l'export des données vers des outils tiers (CSV/Excel) avec filtres par employé, projet et période.

## Module 7 — Pilotage Direction & Admin
1. Fournir une vision consolidée multi-projets en temps réel pour la prise de décision (KPIs, alertes, carte des chantiers actifs).
2. Assurer la gouvernance du système : gestion des comptes et des rôles, logs de suppression de photos immuables.
3. Mesurer la performance opérationnelle globale (heures travaillées, progression par projet, activité photographique).
4. Permettre à la Direction de configurer le rayon de géofencing par chantier.