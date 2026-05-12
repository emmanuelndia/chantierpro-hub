# Fiche Spécification : Documentation Photographique (Mobile & Web)

## 1. Description du besoin
Ce module permet de documenter l'avancement et les incidents sur les chantiers via des photographies sécurisées. Chaque cliché pris sur le terrain est automatiquement horodaté, géolocalisé et associé à un chantier pour garantir sa valeur probatoire et son immutabilité.

## 2. Acteurs & Permissions
- **Technicien / Chef de Projet** : Prise de photos sur mobile. Consultation de la galerie.
- **Chef de Projet / Direction / Admin** : Consultation, filtrage et suppression de photos sur le web.
- **Système** : Enregistrement automatique des métadonnées (GPS, horodatage) et journalisation des suppressions.

## 3. Processus (User Flow)
1. **Prise de Photo (Mobile)** : Ouverture de l'appareil photo via l'app → Capture → Sélection du chantier (si plusieurs) → Upload automatique avec métadonnées.
2. **Consultation (Web)** : Sélection d'un projet/chantier → Galerie chronologique → Filtre par auteur ou date → Agrandissement de la photo.
3. **Suppression (Web)** : Sélection d'une photo → Bouton "Supprimer" → Saisie du motif → Validation → Enregistrement dans le log immuable.

## 4. Règles de Gestion Spécifiques
| Règle | Description |
| :--- | :--- |
| **RG-01 : Capture Directe** | L'application mobile ne permet pas de choisir une photo depuis la galerie du téléphone pour garantir l'authenticité du cliché. |
| **RG-02 : Métadonnées** | Chaque photo doit inclure les coordonnées GPS précises et l'horodatage UTC au moment de la capture. |
| **RG-03 : Droits de Suppression** | Les techniciens n'ont aucun droit de suppression. Seuls les rôles d'encadrement peuvent supprimer. |
| **RG-04 : Piste d'Audit** | Toute suppression est irréversible dans le log de suppression, qui contient l'ID de la photo, l'auteur, la date et le motif. |

## 5. Interface & Écrans
- **Caméra (Mobile)** : Interface simplifiée avec déclencheur central et indicateur de niveau (optionnel).
- **Galerie Chantier (Web)** : Grille de photos avec miniatures, nom de l'auteur et date. Survol pour afficher les coordonnées GPS.
- **Détail Photo (Web)** : Affichage plein écran, carte de localisation à côté de la photo, bouton "Supprimer" pour les profils autorisés.

## 6. Modèle de Données (Impacté)
- `Photo` : id, chantierId, uploadedBy, timestamp, latitude, longitude, storageKey, deletedAt, deletedBy.
- `PhotoDeletionLog` : id, photoId, deletedBy, deletedAt, reason.
