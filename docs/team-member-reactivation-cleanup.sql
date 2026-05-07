-- Nettoyage ponctuel des doublons TeamMember crees avant la correction
-- "reactivation sans doublon".
--
-- A lancer une seule fois en production si un meme utilisateur apparait
-- a la fois INACTIVE et ACTIVE dans la meme equipe.

DELETE FROM "TeamMember" inactive
WHERE inactive.status = 'INACTIVE'
AND EXISTS (
  SELECT 1
  FROM "TeamMember" active
  WHERE active."teamId" = inactive."teamId"
    AND active."userId" = inactive."userId"
    AND active.status = 'ACTIVE'
);
