# Fiche Spécification : Gestion des Projets & Chantiers

## 1. Description du besoin
Ce module permet de structurer l'activité opérationnelle en définissant les projets (affaires globales) et les chantiers (lieux physiques d'intervention). Il assure également le lien entre les ressources humaines (techniciens) et les projets.

## 2. Acteurs & Permissions
- **Chef de Projet** : Création, modification de projets et chantiers. Assignation des techniciens.
- **Direction** : Consultation de tous les projets et chantiers.
- **Technicien** : Consultation des projets/chantiers assignés sur mobile.

## 3. Processus (User Flow)
1. **Création Projet** : Saisie nom, description, dates → Validation.
2. **Création Chantier** : Sélection du projet → Saisie adresse, latitude, longitude, rayon (défaut 2 km) → Validation.
3. **Assignation** : Sélection projet → Sélection techniciens → Validation des accès mobiles.

## 4. Règles de Gestion Spécifiques
- **RG-01** : Un projet peut avoir plusieurs chantiers rattachés.
- **RG-02** : Un technicien ne peut pointer que sur un chantier rattaché à un projet auquel il est assigné.
- **RG-03** : La géolocalisation du chantier est obligatoire pour activer le pointage.

## 5. Interface & Écrans
- **Dashboard Chef de Projet (Web)** : Liste des projets actifs avec dates et nombre de techniciens.
- **Détail Projet (Web)** : Liste des chantiers rattachés, Liste des techniciens assignés, Bouton "Ajouter Chantier", Bouton "Assigner Technicien".
- **Formulaire Chantier (Web)** : Nom, Adresse, Carte interactive pour placer le marqueur GPS, Champ Rayon (km).

## 6. Modèle de Données (Impacté)
- `Project` : id, name, description, startDate, endDate, createdBy, createdAt.
- `Chantier` : id, projectId, name, address, latitude, longitude, radiusKm, createdAt.
- `Assignment` : id, userId, projectId, assignedBy, assignedAt.
