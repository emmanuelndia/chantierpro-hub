# Fiche Spécification : Gestion des Comptes & Authentification

## 1. Description du besoin
Ce module permet de gérer l'accès sécurisé à l'application Chantier Pro. Il centralise la création, la modification et la désactivation des utilisateurs, ainsi que la gestion de leurs rôles et permissions.

## 2. Acteurs & Permissions
- **Administrateur** : Création, modification, désactivation des comptes. Attribution des rôles.
- **Utilisateur (Tous rôles)** : Connexion, déconnexion, réinitialisation de mot de passe.
- **Technicien** : Accès mobile restreint (pointage, photo, historique propre).

## 3. Processus (User Flow)
1. **Connexion** : Saisie email/mot de passe → Validation serveur → Émission JWT + Refresh Token → Redirection selon rôle.
2. **Création de compte** : Admin saisit les infos → Email d'invitation envoyé → Utilisateur définit son mot de passe.
3. **Réinitialisation** : Demande de lien par email → Saisie nouveau mot de passe → Invalidation des sessions précédentes.

## 4. Règles de Gestion Spécifiques
- **RG-01** : Un compte désactivé ne peut plus se connecter et ses tokens existants sont révoqués.
- **RG-02** : Le mot de passe doit comporter au moins 8 caractères, une majuscule et un chiffre.
- **RG-03** : Les sessions mobiles expirent après 30 jours d'inactivité (refresh token).

## 5. Interface & Écrans
- **Écran Connexion (Mobile/Web)** : Champs Email, Mot de passe, Bouton Connexion, Lien Mot de passe oublié.
- **Dashboard Admin (Web)** : Liste des utilisateurs (Nom, Email, Rôle, Statut), Bouton "Ajouter Utilisateur", Actions (Éditer, Désactiver).

## 6. Modèle de Données (Impacté)
- `User` : id, email, passwordHash, role, firstName, lastName, createdAt, isActive.
