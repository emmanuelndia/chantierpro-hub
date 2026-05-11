# Migration planning ressources tournantes

La regle metier du planning autorise une meme ressource terrain a etre assignee le meme jour sur plusieurs chantiers differents.

Depuis l'evolution multi-taches, une meme ressource peut aussi recevoir plusieurs taches sur le meme chantier le meme jour.

La base ne doit donc plus avoir d'index unique actif sur `(supervisorId, date)` ni sur `(supervisorId, date, siteId)`.
Elle doit seulement garder un index non unique de performance sur `(supervisorId, date, siteId)`.

En production Vercel/Neon, appliquer les migrations avant de retester le planning :

```powershell
npx prisma migrate deploy
```

Si l'API retourne `PLANNING_TASKS_MIGRATION_REQUIRED`, la base utilise encore un ancien index unique du planning.
