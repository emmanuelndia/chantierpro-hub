# Fiche Spécification : Pointage Géolocalisé (Mobile)

## 1. Description du besoin
Ce module assure la traçabilité des présences sur le terrain. Il permet aux techniciens de déclarer leur arrivée et leur départ d'un chantier, tout en garantissant que ces déclarations sont effectuées physiquement sur le lieu d'intervention grâce à la géolocalisation.

## 2. Acteurs & Permissions
- **Technicien** : Pointage entrée/sortie sur mobile. Consultation de son propre historique de pointage.
- **Chef de Projet / RH** : Consultation des pointages en temps réel sur le dashboard web.
- **Système** : Validation automatique de la position GPS et calcul de la durée de présence.

## 3. Processus (User Flow)
1. **Ouverture de l'App** : Le technicien voit la liste des chantiers assignés pour la journée.
2. **Pointage Entrée** : Sélection du chantier → Bouton "Entrée" → Demande de position GPS → Validation serveur (rayon < 2 km) → Confirmation.
3. **Pointage Sortie** : Bouton "Sortie" → Demande de position GPS → Validation serveur (rayon < 2 km) → Calcul de la durée → Confirmation.
4. **Erreur de Position** : Si le technicien est hors zone, un message affiche la distance actuelle au chantier et le pointage est refusé.

## 4. Règles de Gestion Spécifiques
| Règle | Description |
| :--- | :--- |
| **RG-01 : Périmètre** | Le pointage est strictement limité à un rayon de 2 km (modifiable par chantier) autour des coordonnées GPS définies. |
| **RG-02 : Horodatage** | L'heure enregistrée est celle du serveur (UTC) pour éviter toute manipulation de l'heure locale du téléphone. |
| **RG-03 : Séquence** | Un technicien ne peut pas effectuer deux pointages "Entrée" consécutifs sur le même chantier sans une "Sortie" intermédiaire. |
| **RG-04 : Offline** | En cas d'absence de réseau, le pointage est mis en file d'attente avec l'heure et la position de capture, puis synchronisé dès le retour du réseau. |

## 5. Interface & Écrans
- **Accueil Technicien (Mobile)** : Affiche le chantier actuel, un bouton large "Pointer mon arrivée" ou "Pointer mon départ".
- **Historique Pointage (Mobile)** : Liste chronologique des sessions (Date, Chantier, Heure Entrée, Heure Sortie, Durée).
- **Alerte Géographique (Mobile)** : Fenêtre contextuelle rouge indiquant "Vous êtes à 3.5 km du chantier. Rapprochez-vous pour pointer."

## 6. Modèle de Données (Impacté)
- `Pointage` : id, userId, chantierId, type (ENTREE | SORTIE), timestamp, latitude, longitude, distanceToSite.
