# Fiche Spécification : RH & Suivi des Heures (Web)

## 1. Description du besoin
Ce module permet d'exploiter les données de pointage pour la gestion administrative et la paie. Il consolide les heures de présence par employé et par projet, et offre des outils d'exportation pour les services RH.

## 2. Acteurs & Permissions
- **RH / Direction / Admin** : Consultation du tableau de bord RH, filtrage des données, export CSV/Excel.
- **Chef de Projet** : Consultation des heures pour les projets qu'il supervise.
- **Technicien** : Aucun accès aux dashboards RH globaux.

## 3. Processus (User Flow)
1. **Consolidation** : Le système calcule quotidiennement les durées entre chaque paire de pointages valide (ENTRÉE/SORTIE).
2. **Consultation RH (Web)** : Accès au dashboard → Sélection du mois → Liste des employés avec heures cumulées.
3. **Détail Employé (Web)** : Clic sur un employé → Liste détaillée des sessions de pointage par jour et par chantier.
4. **Export (Web)** : Clic sur "Exporter" → Génération du fichier CSV/Excel avec toutes les données filtrées.

## 4. Règles de Gestion Spécifiques
| Règle | Description |
| :--- | :--- |
| **RG-01 : Calcul de Durée** | La durée d'une session est calculée par la différence entre l'heure de SORTIE et l'heure d'ENTRÉE. |
| **RG-02 : Sessions Incomplètes** | Une session sans pointage de SORTIE est signalée en rouge et n'est pas comptabilisée tant qu'elle n'est pas régularisée. |
| **RG-03 : Format d'Export** | Les exports doivent respecter une structure compatible avec les logiciels de paie standards (Sage, Silae). |
| **RG-04 : Filtres** | Les filtres par projet et par chantier permettent de ventiler les coûts de main-d'œuvre par affaire. |

## 5. Interface & Écrans
- **Dashboard RH (Web)** : Tableau avec colonnes Employé, Rôle, Heures Normales, Heures Supplémentaires (si configuré), Total Mois.
- **Fiche Présence Employé (Web)** : Calendrier mensuel ou liste chronologique des pointages (Date, Projet, Chantier, Entrée, Sortie, Durée).
- **Zone d'Export (Web)** : Sélecteur de période, Sélecteur de format (CSV, XLSX), Bouton de téléchargement.

## 6. Modèle de Données (Impacté)
- `Pointage` : id, userId, chantierId, type, timestamp, latitude, longitude.
- `User` : id, firstName, lastName, role.
