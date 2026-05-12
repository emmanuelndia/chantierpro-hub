# Fiche Spécification : Pilotage Direction & Administration (Web)

## 1. Description du besoin
Ce module offre une vision de haut niveau pour la direction de l'entreprise et les outils nécessaires à l'administrateur système pour assurer la maintenance et la sécurité de l'application.

## 2. Acteurs & Permissions
- **Direction** : Consultation de tous les dashboards, accès aux photos, suivi des métriques RH, consultation des logs de suppression.
- **Administrateur** : Gestion complète des utilisateurs, rôles, permissions et logs système.
- **Système** : Agrégation en temps réel des données opérationnelles.

## 3. Processus (User Flow)
1. **Consultation Direction (Web)** : Accès au dashboard consolidé → Vue multi-projets avec indicateurs de présence et photos récentes.
2. **Audit (Web)** : Accès à la liste des suppressions de photos → Filtrage par auteur ou date → Vérification du motif de suppression.
3. **Gestion Utilisateurs (Web)** : Liste globale → Ajout/Édition/Désactivation d'utilisateurs → Attribution de rôles (Technicien, CP, RH, Direction, Admin).

## 4. Règles de Gestion Spécifiques
| Règle | Description |
| :--- | :--- |
| **RG-01 : Vision 360** | Le rôle Direction a accès à l'ensemble des données de tous les projets, sans restriction géographique ou d'assignation. |
| **RG-02 : Audit Immuable** | Le journal des suppressions (PhotoDeletionLog) ne peut être ni modifié ni supprimé, même par l'administrateur système. |
| **RG-03 : Rôles Uniques** | Un utilisateur ne peut avoir qu'un seul rôle principal à la fois dans le système. |
| **RG-04 : Désactivation** | La désactivation d'un compte utilisateur conserve l'historique de ses pointages et photos mais lui retire tout accès immédiat. |

## 5. Interface & Écrans
- **Dashboard Direction (Web)** : Cartes avec KPIs (Projets actifs, Techniciens sur site, Photos du jour), Graphiques d'évolution des heures de présence.
- **Journal d'Audit (Web)** : Tableau listant les suppressions (Date, Auteur, ID Photo supprimée, Motif, Lien vers le projet concerné).
- **Gestion des Rôles (Web)** : Matrice de permissions ou sélecteur de rôle dans la fiche utilisateur.

## 6. Modèle de Données (Impacté)
- `PhotoDeletionLog` : id, photoId, deletedBy, deletedAt, reason.
- `User` : id, role, isActive.
