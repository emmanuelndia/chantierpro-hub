# Chantier Pro — Spécifications Fonctionnelles & Techniques

Bienvenue dans la documentation de **Chantier Pro**, l'application de gestion de chantier centrée sur la traçabilité des présences et la documentation photographique immuable.

## 1. Vision du Produit
Chantier Pro résout les problèmes de fiabilité des pointages et de dispersion de la documentation terrain en imposant un **géofencing strict de 2 km** pour le pointage et une **capture photo sécurisée** avec métadonnées GPS et horodatage UTC.

## 2. Structure de la Documentation
La documentation est organisée selon le modèle "Truth Store" pour garantir une source de vérité unique et exploitable par les équipes de développement.

### Documents Transverses
- **[Problems & Goals](./problems-goals.md)** : Les enjeux métier par module.
- **[User Stories](./user-stories.md)** : Les besoins utilisateurs par rôle.
- **[Business Rules](./business-rules.md)** : Les règles de gestion critiques et calculs.
- **[Functional Requirements](./functionnal-requirements.md)** : La liste exhaustive des exigences.

### Spécifications Détaillées (Specs Détaillées)
Chaque module dispose de sa propre fiche technique :
1. **[01 — Référentiel Utilisateurs & Authentification](./specs-detaillees/01-referentiel-utilisateurs/01-gestion-comptes.md)**
2. **[02 — Projets & Chantiers](./specs-detaillees/02-projets-chantiers/01-gestion-projets-chantiers.md)**
3. **[03 — Pointage Géolocalisé](./specs-detaillees/03-pointage-geolocalise/01-pointage-geolocalise.md)**
4. **[04 — Documentation Photographique](./specs-detaillees/04-documentation-photo/01-documentation-photo.md)**
5. **[05 — RH & Suivi des Heures](./specs-detaillees/05-rh-suivi-heures/01-rh-suivi-heures.md)**
6. **[06 — Pilotage Direction & Administration](./specs-detaillees/06-pilotage-direction-admin/01-pilotage-direction-admin.md)**

## 3. Rôles Utilisateurs
| Rôle | Description |
| :--- | :--- |
| **Technicien** | Utilisateur terrain (pointage, photo, historique). |
| **Chef de Projet** | Gestionnaire opérationnel (projets, chantiers, assignations, photos). |
| **RH** | Gestionnaire administratif (heures mensuelles, exports paie). |
| **Direction** | Vision stratégique (dashboards consolidés, audit, métriques). |
| **Admin** | Gestionnaire système (comptes, rôles, sécurité). |

## 4. Stack Technique Suggérée
- **Mobile** : React Native (Expo)
- **Web** : Next.js + Tailwind CSS
- **Backend** : Node.js (Fastify) + PostgreSQL (Prisma)
- **Stockage** : S3 / Cloudflare R2 (Bucket privé)
- **Auth** : JWT + Refresh Token
