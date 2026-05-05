# 🌍 Données de Test - Côte d'Ivoire

Ce document explique comment utiliser les données de test spécifiques à la Côte d'Ivoire pour tester efficacement ChantierPro.

## 📍 Localisations des Chantiers

### Abidjan et Régions
- **Cocody Centre Commercial** - 5.3614°N, 3.9873°W
- **Plateau Siège Social** - 5.3274°N, 4.0251°W  
- **Yopougon Industriel** - 5.3599°N, 4.0883°W
- **Yopougon Résidentiel** - 5.3499°N, 4.0783°W

### Bondoukou (Intérieur)
- **Bondoukou Centre** - 8.0406°N, 2.8014°W
- **Bondoukou Extension** - 8.0506°N, 2.7914°W

## 👥 Comptes de Test

### Coordinateurs
| Email | Mot de passe | Nom | Région |
|-------|-------------|-----|--------|
| `koordinator@chantierpro.ci` | `ChantierPro2024!` | Konan Bamba | Abidjan |
| `yao.coordinator@chantierpro.ci` | `ChantierPro2024!` | Yao Kouadio | Bondoukou |

### Superviseurs
| Email | Mot de passe | Nom | Sites assignés |
|-------|-------------|-----|----------------|
| `traore.sup@chantierpro.ci` | `ChantierPro2024!` | Mamadou Traoré | Cocody, Plateau |
| `kone.sup@chantierpro.ci` | `ChantierPro2024!` | Alassane Koné | Yopougon Industriel, Résidentiel |
| `sangare.sup@chantierpro.ci` | `ChantierPro2024!` | Adama Sangaré | Bondoukou Centre |
| `ouattara.sup@chantierpro.ci` | `ChantierPro2024!` | Ibrahim Ouattara | Bondoukou Extension |

## 🚀 Installation des Données

### 1. Base de données vide
```bash
# Réinitialiser et peupler avec les données ivoiriennes
npm run db:reset-seed
```

### 2. Ajouter aux données existantes
```bash
# Ajouter seulement les données de test Côte d'Ivoire
npm run db:seed-ivorycoast
```

### 3. Générer Prisma Client
```bash
npm run prisma:generate
```

## 📱 Scénarios de Test

### Test GPS et Géolocalisation
1. **Test en zone** : Positionnez-vous près des coordonnées GPS ci-dessus
2. **Test hors zone** : Éloignez-vous de plus de 1km des sites
3. **Test multi-sites** : Testez la navigation entre Abidjan et Bondoukou

### Test Workflow Coordinateur
1. Connectez-vous avec `koordinator@chantierpro.ci`
2. Vérifiez le dashboard avec les KPIs
3. Testez les rappels aux superviseurs
4. Validez les rapports reçus

### Test Workflow Superviseur
1. Connectez-vous avec `traore.sup@chantierpro.ci`
2. Pointez arrivée/départ sur les sites Cocody/Plateau
3. Prenez des photos sur le chantier
4. Soumettez un rapport de fin de journée

## 📊 Données Générées

### Sessions de Pointage
- **5 jours d'historique** avec sessions réelles
- **Heures variées** : 7h-8h (arrivée), 16h-17h (départ)
- **Sessions en cours** pour les 2 derniers jours

### Rapports Terrain
- **Contenu réaliste** en français
- **Photos de test** (via Picsum Photos)
- **Statuts variés** : Soumis, Validé, Envoyé

### Projects
- **Centre Commercial Abidjan** (Cocody)
- **Rénovation Route Yopougon-Plateau**
- **Complexes Résidentiels Bondoukou**

## 🧪 Tests Recommandés

### Test Mobile PWA
```bash
npm run dev
# Accéder via mobile sur http://localhost:3000
```

### Test Notifications
- Les rappels aux superviseurs créent des notifications
- Testez les notifications push (configuration requise)

### Test Offline
- Activez le mode avion sur mobile
- Vérifiez que les données restent accessibles
- Testez la synchronisation when back online

## 🔧 Personnalisation

### Ajouter de nouveaux sites
Éditez `prisma/seed-ivory-coast.ts` et ajoutez des sites avec :
```typescript
{
  name: 'Nouveau Site',
  address: 'Adresse complète',
  latitude: 5.xxxx,  // Coordonnées GPS réelles
  longitude: -4.xxxx,
  radiusKm: 1.0,
  status: 'ACTIVE',
}
```

### Modifier les utilisateurs
Changez les emails/mots de passe dans le même fichier et réexécutez :
```bash
npm run db:seed-ivorycoast
```

## 📝 Notes importantes

- **Mot de passe par défaut** : `ChantierPro2024!` pour tous les comptes
- **Coordonnées GPS** basées sur des lieux réels en Côte d'Ivoire
- **Fuseau horaire** : GMT (UTC+0)
- **Langue** : Français (tous les contenus sont en français)

## 🆘 Support

Si vous rencontrez des problèmes :
1. Vérifiez que Prisma est bien configuré
2. Assurez-vous que la base de données est accessible
3. Consultez les logs dans la console pour les erreurs détaillées

---
*Créé pour faciliter les tests de ChantierPro dans le contexte ivoirien* 🇨🇮
