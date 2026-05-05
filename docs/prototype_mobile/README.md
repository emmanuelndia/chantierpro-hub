# Chantier Pro - Prototype Multi-pages

Prototype HTML/CSS/JavaScript de l'application Chantier Pro avec navigation complète entre les écrans.

## 📁 Structure

```
chantier-prototype/
├── auth/
│   └── login.html              # Page de connexion
├── technicien/
│   ├── home.html               # Accueil technicien (pointage)
│   ├── pointage.html           # Système de pointage complet (UC1-UC4)
│   ├── photo.html              # Appareil photo
│   └── historique.html         # Historique des pointages
├── management/
│   ├── dashboard.html          # Dashboard direction
│   ├── chantier-detail.html    # Détail projet avec onglets
│   ├── galerie.html            # Galerie photos avec filtres
│   └── presences.html          # Suivi des présences
├── styles.css                  # Styles communs factorisés
└── README.md                   # Documentation
```

## 🎯 Flux de navigation

### Authentification
- `login.html` → `technicien/home.html`

### Technicien (navigation inférieure)
- 🏠 Accueil → `technicien/home.html`
- 📷 Photo → `technicien/photo.html`
- 📋 Historique → `technicien/historique.html`

### Management (navigation inférieure)
- 🏗️ Projets → `management/dashboard.html`
- 📷 Galerie → `management/galerie.html`
- 👥 Présences → `management/presences.html`
- 👤 Profil → (à implémenter)

### Interactions spécifiques
- Dashboard → cliquer sur "Rénovation Rue de Lyon" → `management/chantier-detail.html`
- Détail projet → onglets Général/Chantiers/Photos/Présences
- Galerie → filtres Récent/Projet/Chantier + modal photo
- Retour → flèche "←" vers page précédente

## 🎨 Fonctionnalités implémentées

### ✅ Pages créées
- [x] Login avec navigation vers home
- [x] Home technicien avec géolocalisation et pointage
- [x] **Pointage complet avec 4 cas d'usage (UC1-UC4)** :
  - UC1 Arrivée : géolocalisation, validation de zone, confirmation
  - UC2 Session active : timeline, pointages intermédiaires, durée en temps réel
  - UC3 Notification auto : simulation de push, confirmation présence
  - UC4 Départ : confirmation, récapitulatif, clôture session
- [x] Appareil photo avec viseur
- [x] Historique des pointages
- [x] Dashboard direction avec statistiques
- [x] Détail projet avec onglets interactifs
- [x] Galerie photos avec 3 modes de tri
- [x] Présences avec filtres par chantier

### ✅ Interactions
- [x] Navigation complète entre toutes les pages
- [x] **Système de pointage avancé** :
  - Géolocalisation simulée avec validation de zone (≤2km)
  - Timeline dynamique avec pointages intermédiaires
  - Durée de session en temps réel
  - Notifications push simulées
  - Confirmation de départ avec récapitulatif
- [x] Onglets fonctionnels dans détail projet
- [x] Filtres actifs dans galerie
- [x] Modal pour détail photo avec suppression
- [x] Hover sur tous les éléments cliquables
- [x] Simulations d'actions (pointage, photo, etc.)

### ✅ Design
- [x] Styles factorisés dans `styles.css`
- [x] Design conservé exactement
- [x] Responsive mobile-first
- [x] Transitions et micro-interactions

## 🚀 Utilisation

1. Ouvrir `auth/login.html` dans un navigateur
2. Cliquer sur "Se connecter" pour accéder à l'espace technicien
3. Naviguer avec les menus inférieurs
4. Pour la vue direction, accéder directement à `management/dashboard.html`

## 🔧 Points d'extension

### À implémenter
- Véritable système d'authentification
- API pour les données dynamiques
- Upload et stockage des photos
- Notifications push
- Mode hors-ligne
- Synchronisation des données

### Idées d'amélioration
- Animations de transition entre pages
- Swipe navigation pour mobile
- Mode sombre
- Widgets personnalisables
- Export des rapports

## 📱 Compatibilité

- Optimisé pour mobile (320px+)
- Compatible tous navigateurs modernes
- Structure prête pour React Native ou Next.js
- Accessibilité de base (ARIA labels à ajouter)

---

**Prototype créé à partir des maquettes Figma/HTML existantes**
