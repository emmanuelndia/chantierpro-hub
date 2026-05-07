# Migration planning ressources tournantes

La regle metier du planning autorise une meme ressource terrain a etre assignee le meme jour sur plusieurs chantiers differents.

La base doit donc avoir l'index unique actif sur `(supervisorId, date, siteId)`, et ne doit plus avoir l'ancien index `(supervisorId, date)`.

En production Vercel/Neon, appliquer les migrations avant de retester le planning :

```powershell
npx prisma migrate deploy
```

Si l'API retourne `PLANNING_TURNOVER_MIGRATION_REQUIRED`, la base utilise encore l'ancien index `PlanningAssignment_supervisor_date_active_key`.
