# TO_DO - Import Planning Excel Et Correction Offline Pointage

## Summary
Ajouter deux chantiers prioritaires dans le backlog :

1. **Import de planning Excel multi-formats** pour creer automatiquement des taches planning ou des modeles de taches selon le type de fichier.
2. **Correction du pointage offline**, en particulier le pointage bureau actuellement grise hors ligne malgre `Offline pret`.

Le premier sujet couvre les besoins d'upload planning des chefs de projet. Le second corrige l'ecart actuel entre la promesse offline et la realite terrain.

## Key Changes

### 1. Import De Planning Excel Multi-Formats
- Ajouter dans le `Planning` web un bloc `Importer un planning` avec :
  - `Telecharger le modele`
  - `Choisir un fichier`
  - `Previsualiser` 0777214431
  - `Importer`
- Creer des endpoints dedies :
  - `GET /api/planning/import/template`
  - `POST /api/planning/import/preview`
  - `POST /api/planning/import/commit`
- Detecter automatiquement deux formats :
  - **Format A - planning par ressource**
    colonnes du type `DATE`, `NOM DE LA RESSOURCE`, `NOM DU PROJET`, `NOM DU SITE / ADRESSE GEOGRAPHIQUE`, `ACTION DU JOUR`, `PROGRESSION EN %`, `BLOCAGE OU REMARQUE`
  - **Format B - planning projet / objectifs sans ressource**
    colonnes du type `Localite`, `Tache`, `Unite`, `Objectif`, `Realise`, `%`, `Ecart`, `Duree (j)` + colonnes de jours
- **Format A** :
  - cree des taches assignees
  - detecte automatiquement `Chantier`, `Bureau` ou `Zone`
  - permet correction en preview si ressource/projet/site/type est ambigu
  - cree :
    - `PlanningAssignment` pour `Chantier`
    - `PlanningAssignment` avec `workLocationType = OFFICE` pour `Bureau`
    - `FreeMission` pour `Zone`
- **Format B** :
  - ne cree pas d'assignations directes
  - cree ou met a jour des **modeles de taches planning**
  - permet ensuite au PM d'utiliser `Utiliser un modele` pour affecter les ressources
- Fournir un nouveau modele Excel officiel avec deux onglets :
  - `planning_ressources`
  - `planning_modeles`
- Ajouter les types dedies :
  - `PlanningImportDetectedFormat = "RESOURCE_ROWS" | "PROJECT_MATRIX"`
  - `PlanningImportNormalizedRow`
  - `PlanningImportPreviewRow`
  - `PlanningImportPreviewResponse`
  - `PlanningImportCommitResponse`

### 2. Corriger Le Pointage Offline Reel
- Garder la logique de preparation offline deja corrigee :
  - `offline-user` obligatoire
  - recalcul de `missingData` a chaque lecture
  - `Offline pret` seulement si les donnees critiques sont reellement presentes
- Corriger maintenant la logique de `Pointer` :
  - ne plus bloquer `Bureau` et `Zone` simplement parce que `networkState === 'offline'`
  - autoriser le pointage si :
    - le mode offline du jour est pret
    - le contexte selectionne est valide
    - le GPS est pret
- Reviser `canSubmit` dans l'ecran mobile de pointage pour que :
  - `Bureau` puisse etre pointe hors ligne si `Offline pret`
  - `Zone` puisse etre pointee hors ligne si `Offline pret`
  - `Chantier` conserve sa logique terrain actuelle, avec possibilite offline selon les donnees preparees
- Garder le GPS comme preuve obligatoire en v1 :
  - si le GPS n'est pas pret, afficher un message explicite
  - ne pas laisser seulement un bouton grise sans explication
- Ajouter des messages metier plus clairs :
  - `Offline pret mais GPS indisponible`
  - `Preparation offline manquante pour ce pointage`
  - `Reconnectez-vous pour preparer le mode hors ligne`
- S'assurer que le pointage bureau offline s'empile bien dans la file locale existante :
  - `enqueueOfflineClockIn`
  - puis synchronisation normale au retour reseau
- Aligner l'ecran `Sync` et l'ecran `Pointer` sur les memes criteres :
  - si l'app promet `Offline pret`, le bureau doit reellement pouvoir etre pointe hors ligne si le GPS remonte
- Conserver la regle actuelle :
  - le bureau reste lie a `officeLocationId`
  - la tache bureau liee via `planningAssignmentId` reste facultative mais doit continuer a fonctionner aussi offline si elle a ete preparee

### 3. UX Mobile Offline
- Dans `Pointer > Bureau`, afficher un etat lisible :
  - `Offline pret`
  - `GPS pret` / `GPS indisponible`
  - `Bureau selectionne`
- Ne plus donner l'impression que l'offline est pret si l'action terrain reste inutilisable
- Si l'utilisateur est hors ligne avec preparation incomplete :
  - montrer une alerte claire avant la zone d'action
  - ne pas attendre le clic pour reveler le blocage
- Si le GPS ne remonte pas hors ligne sur certains telephones :
  - afficher explicitement que le blocage vient du GPS et non de la session offline

## Test Plan
- **Import planning**
  - importer un fichier type `03 07.2025.xlsx`
    - detection `planning par ressource`
    - creation de taches `Chantier`, `Bureau` ou `Zone`
  - importer un fichier type `PLANNING_DE_REALISATION...xlsx`
    - detection `planning projet / objectifs`
    - creation de modeles de taches
  - verifier la preview :
    - ressource introuvable
    - projet introuvable
    - site ambigu
    - type corrige
  - verifier l'apparition des taches dans :
    - planning web
    - mobile `Taches`
    - `Pointer`

- **Offline**
  - preparer offline avec reseau, puis couper internet :
    - `Pointer > Bureau` reste disponible
    - le bouton n'est pas grise si GPS pret
  - hors ligne avec GPS pret :
    - pointage bureau possible
    - entree stockee dans la file locale
  - hors ligne avec GPS indisponible :
    - message explicite visible
    - bouton bloque avec raison comprehensible
  - reouverture de l'app hors ligne apres `Offline pret` :
    - pas de `Session offline indisponible`
    - l'utilisateur local est retrouve
  - retour reseau :
    - synchronisation du pointage offline bureau
    - la presence bureau remonte correctement

## Assumptions
- L'import planning demarre dans le `Planning` web, pas dans le detail projet.
- Les fichiers sans colonne ressource ne doivent pas creer d'assignations automatiques.
- Le format historique reste supporte par detection automatique, mais le nouveau template devient le format recommande.
- `Offline pret` doit signifier qu'un pointage bureau ou zone peut reellement etre tente hors ligne si le GPS est disponible.
- Le GPS reste obligatoire pour le pointage offline en v1 ; on ne bascule pas encore vers un mode degrade sans coordonnees.
