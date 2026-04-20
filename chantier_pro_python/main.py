from datetime import datetime
import math

# ── Constantes ────────────────────────────────────────────
ROLES = ["TECHNICIEN", "CHEF_PROJET", "RH", "DIRECTION", "ADMIN"]

PERMISSIONS = {
    "TECHNICIEN": [
        "POINTER",
        "PRENDRE_PHOTO",
        "VOIR_SES_POINTAGES"
    ],
    "CHEF_PROJET": [
        "PRENDRE_PHOTO",
        "SUPPRIMER_PHOTO",
        "GERER_PROJETS",
        "GERER_EQUIPE",
        "GERER_CHANTIER",
        "VOIR_PRESENCES"
    ],
    "RH": [
        "PRENDRE_PHOTO",
        "VOIR_HEURE_RH",
        "EXPORTER_DONNEES"
    ],
    "DIRECTION": [
        "PRENDRE_PHOTO",
        "SUPPRIMER_PHOTO",
        "GERER_PROJETS",
        "GERER_EQUIPE",
        "GERER_CHANTIER",
        "VOIR_PRESENCES",
        "VOIR_HEURE_RH",
        "EXPORTER_DONNEES",
        "VOIR_LOGS_SUPPRESSION"
    ],
    "ADMIN": ["*"],
}

EXCLUSION_PERMISSIONS  = {"ADMIN": ["POINTER"]}
TYPE_POINTAGE          = ["ARRIVEE", "DEPART", "INTERMEDIAIRE"]
STATUT_POINTAGE        = ["VALIDE", "REFUSE"]
STATUT_PROJET          = ["EN_COURS", "TERMINE", "EN_PAUSE", "ARCHIVE"]
STATUT_CHANTIER        = ["ACTIF", "TERMINE", "EN_PAUSE"]
STATUT_EQUIPE          = ["ACTIVE", "INACTIVE"]
ROLE_EQUIPE            = ["CHEF_EQUIPE", "MEMBRE"]
STATUT_EQUIPEMEMBRE    = ["ACTIF", "INACTIF"]
CATEGORIE_PHOTO        = ["AVANCEMENT", "INCIDENT", "AUTRE"]


# ── USER ──────────────────────────────────────────────────
class User:

    def __init__(self, id, nom, prenom, password, role, contact, isActive=True):
        self.id       = id
        self.nom      = nom
        self.prenom   = prenom
        self.password = password
        self.role     = role
        self.contact  = contact
        self.isActive = isActive

    def peut(self, action):
        if self.role not in PERMISSIONS:
            return False
        perms = PERMISSIONS[self.role]
        if "*" in perms:
            excluded = EXCLUSION_PERMISSIONS.get(self.role, [])
            return action not in excluded
        return action in perms

    def modifierProfil(self, **kwargs):
        for cle, valeur in kwargs.items():
            if cle in ['nom', 'prenom', 'contact', 'password']:
                setattr(self, cle, valeur)

    def desactiverCompte(self, admin_user):
        if not admin_user.role == "ADMIN":
            raise Exception("Action réservée aux administrateurs")
        self.isActive = False

    def pointer(self, chantier, type_pointage, lat, lng):
        if not self.isActive:
            raise Exception("Compte utilisateur inactif")
        if not self.peut("POINTER"):
            raise Exception("Permission refusée : cet utilisateur ne peut pas pointer")
        if not chantier.estActif():
            raise Exception("Ce chantier n'est pas actif")

        # ── Nouveaux cas limites ──────────────────────────────
        if type_pointage == "ARRIVEE":
            if chantier.aDejaUnPointageOuvert(self):
                raise Exception("Une session est déjà ouverte sur ce chantier")

        if type_pointage == "DEPART":
            if not chantier.aDejaUnPointageOuvert(self):
                raise Exception("Aucune arrivée enregistrée pour clôturer")
        # ─────────────────────────────────────────────────────

        distance = chantier.verifierPointage(self, lat, lng)
        if distance > 2.0:
            raise Exception(f"Pointage refusé : vous êtes à {distance:.2f} km du chantier")

        pointage = Pointage(
            chantier=chantier,
            user=self,
            type_pointage=type_pointage,
            latitude=lat,
            longitude=lng,
            distance_chantier=distance
        )
        return pointage

    def prendrePhoto(self, chantier, fichier, categorie=None):
        if not self.isActive:
            raise Exception("Compte utilisateur inactif")
        if not self.peut("PRENDRE_PHOTO"):
            raise Exception("Permission refusée")
        if not chantier.estActif():
            raise Exception("Ce chantier n'est pas actif")

        photo = Photo(
            chantier  = chantier,
            user      = self,
            fichier   = fichier,
            categorie = categorie
        )
        return photo

    def getHistoriquePointages(self, chantier):
        if not self.peut("VOIR_SES_POINTAGES"):
            raise Exception("Permission refusée")

        return [p for p in chantier.getPointages() if p.user.id == self.id]

    def exporterDonnees(self, chantier, mois, annee):
        if not self.peut("EXPORTER_DONNEES"):
            raise Exception("Permission refusée")

        pointages_mois = [
            p for p in chantier.getPointages()
            if p.date_pointage.startswith(f"{annee}-{mois:02d}")
        ]

        lignes = []
        for p in pointages_mois:
            lignes.append({
                "employe": f"{p.user.prenom} {p.user.nom}",
                "type": p.type_pointage,
                "date": p.date_pointage,
                "heure": p.heure_pointage,
                "statut": p.statut,
                "distance": p.distance_chantier
            })

        return lignes  # Phase 3 → vrai fichier CSV

    def __repr__(self):
        return f"User({self.prenom} {self.nom} | {self.role})"


# ── POINTAGE ──────────────────────────────────────────────
class Pointage:

    def __init__(self, chantier, user, type_pointage, latitude, longitude,
                 distance_chantier):

        # Cas limite
        if type_pointage not in TYPE_POINTAGE:
            raise Exception(f"Type de pointage invalide : {type_pointage}")

        self.chantier          = chantier
        self.user              = user
        self.type_pointage     = type_pointage
        self.latitude          = latitude
        self.longitude         = longitude
        self.distance_chantier = distance_chantier
        self.date_pointage     = datetime.now().strftime("%Y-%m-%d")
        self.heure_pointage    = datetime.now().strftime("%H:%M:%S")
        self.statut            = "VALIDE" if distance_chantier <= 2.0 else "REFUSE"

    def estValide(self):
        return self.statut == "VALIDE" and self.distance_chantier <= 2.0

    def getDistanceChantier(self):
        return self.distance_chantier

    def getTypePointage(self):
        return self.type_pointage

    def getDureeSession(self, pointage_arrivee):
        if self.type_pointage != "DEPART":
            raise Exception("getDureeSession() uniquement disponible sur un DEPART")
        if pointage_arrivee.type_pointage != "ARRIVEE":
            raise Exception("Le pointage fourni n'est pas une ARRIVEE")

        format_heure  = "%H:%M:%S"
        heure_arrivee = datetime.strptime(pointage_arrivee.heure_pointage, format_heure)
        heure_depart  = datetime.strptime(self.heure_pointage, format_heure)
        return heure_depart - heure_arrivee

    def __repr__(self):
        return (f"Pointage({self.user.prenom} {self.user.nom} | "
                f"{self.type_pointage} | {self.heure_pointage} | "
                f"{self.statut} | {self.distance_chantier:.2f} km)")


# ── PROJET ────────────────────────────────────────────────
class Projet:

    def __init__(self, id, nom, adresse, description, ville, date_debut, date_fin, budget_total, chef_projet, created_by,
                 statut="EN_COURS"):

        if not created_by.peut("GERER_PROJETS"):
            raise Exception(f"{created_by.prenom} n'est pas habilité à faire cette action")
        if statut not in STATUT_PROJET:
            raise Exception(f"Statut invalide : {statut}")

        self.id           = id
        self.nom          = nom
        self.adresse      = adresse
        self.description  = description
        self.ville        = ville
        self.date_debut   = date_debut
        self.date_fin     = date_fin
        self.budget_total = budget_total
        self.chef_projet  = chef_projet
        self.created_by   = created_by
        self.statut       = statut
        self.chantiers    = []

    def modifierProjet(self, modifier_by, **kwargs):
        if not modifier_by.peut("GERER_PROJETS"):
            raise Exception("Permission refusée")
        for cle, valeur in kwargs.items():
            if cle in ['nom', 'ville', 'budget_total', 'statut']:
                if cle == 'statut' and valeur not in STATUT_PROJET: continue
                setattr(self, cle, valeur)

    def supprimerProjet(self, deleted_by):
        if not deleted_by.peut("GERER_PROJETS"):
            raise Exception("Permission refusée")
        if any(c.estActif() for c in self.chantiers):
            raise Exception("Impossible de supprimer : Chantiers en cours")
        self.statut = "ARCHIVE"  # Suppression logique

    def ajouterChantier(self, chantier):
        if self.statut in ["TERMINE", "ARCHIVE"]:
            raise Exception("Impossible d'ajouter un chantier : projet terminé")
        if chantier in self.chantiers:
            raise Exception("Ce chantier est déjà rattaché au projet")
        self.chantiers.append(chantier)

    def getChantiers(self):
        return self.chantiers

    def getChantiersActifs(self):
        return [c for c in self.chantiers if c.estActif()]

    def estActif(self):
        return self.statut == "EN_COURS"

    def getBudgetConsomme(self):
        return sum(c.budget_alloue for c in self.chantiers)

    def getBudgetRestant(self):
        return self.budget_total - self.getBudgetConsomme()

    def __repr__(self):
        return (f"Projet({self.nom} | {self.ville} | {self.statut} | "
                f"Budget: {self.budget_total} | Chantiers: {len(self.chantiers)})")


# ── CHANTIER ──────────────────────────────────────────────
class Chantier:

    def __init__(self, id, projet, nom, localisation, adresse, description,
                 date_debut, date_fin, superficie, budget_alloue,
                 chef_projet, created_by, statut="ACTIF"):

        if not created_by.peut("GERER_CHANTIER"):
            raise Exception(f"Action non autorisée")
        if statut not in STATUT_CHANTIER:
            raise Exception(f"Statut invalide : {statut}")

        self.id           = id
        self.projet       = projet
        self.nom          = nom
        self.localisation = localisation  # (lat, lng)
        self.adresse      = adresse
        self.description  = description
        self.date_debut   = date_debut
        self.date_fin     = date_fin
        self.superficie   = superficie
        self.budget_alloue = budget_alloue
        self.chef_projet  = chef_projet
        self.created_by   = created_by
        self.statut       = statut

        # Listes internes
        self.pointages = []
        self.photos    = []
        self.equipes   = []

    def modifierChantier(self, modifier_by, **kwargs):
        if not modifier_by.peut("GERER_CHANTIER"):
            raise Exception("Permission refusée")
        if 'budget_alloue' in kwargs:
            diff = kwargs['budget_alloue'] - self.budget_alloue
            if diff > self.projet.getBudgetRestant(): raise Exception("Budget projet dépassé")

        for cle, valeur in kwargs.items():
            if cle in ['nom', 'budget_alloue', 'statut']:
                setattr(self, cle, valeur)

    def supprimerChantier(self, deleted_by):
        if not deleted_by.peut("GERER_CHANTIER"):
            raise Exception("Permission refusée")
        self.statut = "ANNULE" if not self.pointages else "TERMINE"

    # ── Vérification GPS ──────────────────────────────────
    def verifierPointage(self, user, lat, lng):
        # Calcul distance en km avec la formule de Haversine
        lat1, lng1 = self.localisation
        lat2, lng2 = lat, lng

        R = 6371  # rayon de la Terre en km

        d_lat = math.radians(lat2 - lat1)
        d_lng = math.radians(lng2 - lng1)

        a = (math.sin(d_lat / 2) ** 2 +
             math.cos(math.radians(lat1)) *
             math.cos(math.radians(lat2)) *
             math.sin(d_lng / 2) ** 2)

        distance = R * 2 * math.asin(math.sqrt(a))
        return round(distance, 2)

    # ── Gestion des équipes ───────────────────────────────
    def assignerEquipe(self, equipe):
        if equipe in self.equipes:
            raise Exception("Cette équipe est déjà assignée au chantier")
        self.equipes.append(equipe)

    def getEquipes(self):
        return self.equipes

    # ── Gestion des pointages ─────────────────────────────
    def ajouterPointage(self, pointage):
        self.pointages.append(pointage)

    def getPointages(self):
        return self.pointages

    def calculerPresencesJour(self, date):
        # Compte les techniciens avec un pointage ARRIVEE VALIDE à cette date
        presents = set()
        for p in self.pointages:
            if (p.date_pointage == date and
                p.type_pointage == "ARRIVEE" and
                p.estValide()):
                presents.add(p.user.id)
        return len(presents)

    def aDejaUnPointageOuvert(self, user):
        arrivees = [p for p in self.pointages
                    if p.user.id == user.id and p.type_pointage == "ARRIVEE" and p.estValide()]
        departs = [p for p in self.pointages
                   if p.user.id == user.id and p.type_pointage == "DEPART" and p.estValide()]
        return len(arrivees) > len(departs)

    def getTechniciensPresents(self, date):
        if not self.estActif():
            raise Exception("Ce chantier n'est pas actif")

        presents = {}
        for p in self.pointages:
            if p.date_pointage == date and p.estValide():
                if p.type_pointage == "ARRIVEE":
                    presents[p.user.id] = p.user
                elif p.type_pointage == "DEPART":
                    presents.pop(p.user.id, None)

        return list(presents.values())

    def getLogsSuppressionPhotos(self, demandeur):
        if not demandeur.peut("VOIR_LOGS_SUPPRESSION"):
            raise Exception("Permission refusée")

        logs = []
        for photo in self.photos:
            if photo.est_supprimee and hasattr(photo, 'log'):
                logs.append(photo.log)
        return logs

    # ── Gestion des photos ────────────────────────────────
    def ajouterPhoto(self, photo):
        self.photos.append(photo)

    def getPhotos(self):
        return self.photos

    # ── Statut ────────────────────────────────────────────
    def estActif(self):
        return self.statut == "ACTIF"

    def __repr__(self):
        return (f"Chantier({self.nom} | {self.statut} | "
                f"Budget: {self.budget_alloue} | "
                f"Pointages: {len(self.pointages)} | "
                f"Photos: {len(self.photos)})")


# ── EQUIPE ────────────────────────────────────────────────
class Equipe:

    def __init__(self, id, nom, chantier, created_by,
                 description=None, chef_equipe=None, statut="ACTIVE"):

        if not created_by.peut("GERER_EQUIPE"):
            raise Exception(f"{created_by.prenom} n'est pas habilité faire cette action")
        if statut not in STATUT_EQUIPE:
            raise Exception(f"Statut invalide : {statut}")

        self.id          = id
        self.nom         = nom
        self.chantier    = chantier
        self.created_by  = created_by
        self.description = description
        self.chef_equipe = chef_equipe
        self.statut      = statut
        self.membres     = []  # liste d'EquipeMembre

    def modifierEquipe(self, modifier_by, **kwargs):
        if not modifier_by.peut("GERER_EQUIPE"):
            raise Exception("Permission refusée")
        for cle, valeur in kwargs.items():
            if cle in ['nom', 'statut']: setattr(self, cle, valeur)

    def supprimerEquipe(self, deleted_by):
        if not deleted_by.peut("GERER_EQUIPE"):
            raise Exception("Permission refusée")
        self.statut = "INACTIVE"

    def ajouterMembre(self, user, role_equipe):
        if role_equipe not in ROLE_EQUIPE:
            raise Exception(f"Rôle équipe invalide : {role_equipe}")
        if self.contientUser(user):
            raise Exception(f"{user.prenom} est déjà membre de cette équipe")

        membre = EquipeMembre(
            equipe      = self,
            user        = user,
            role_equipe = role_equipe
        )
        self.membres.append(membre)
        return membre

    def retirerMembre(self, user):
        for m in self.membres:
            if m.user.id == user.id and m.estActif():
                m.terminerAffectation(datetime.now().strftime("%Y-%m-%d"))
                return
        raise Exception(f"{user.prenom} n'est pas membre actif de cette équipe")

    def getMembres(self):
        return [m for m in self.membres if m.estActif()]

    def contientUser(self, user):
        return any(m.user.id == user.id and m.estActif() for m in self.membres)

    def estActive(self):
        return self.statut == "ACTIVE"

    def __repr__(self):
        return (f"Equipe({self.nom} | {self.statut} | "
                f"Membres actifs: {len(self.getMembres())})")


# ── EQUIPEMEMBRE ──────────────────────────────────────────
class EquipeMembre:

    def __init__(self, equipe, user, role_equipe):
        self.equipe                = equipe
        self.user                  = user
        self.role_equipe           = role_equipe
        self.date_affectation      = datetime.now().strftime("%Y-%m-%d")
        self.date_fin_affectation  = None
        self.statut                = "ACTIF"

    def estActif(self):
        return self.statut == "ACTIF"

    def terminerAffectation(self, date):
        self.statut               = "INACTIF"
        self.date_fin_affectation = date

    def __repr__(self):
        return (f"EquipeMembre({self.user.prenom} {self.user.nom} | "
                f"{self.role_equipe} | {self.statut})")


# ── PHOTO ─────────────────────────────────────────────────
class Photo:

    def __init__(self, chantier, user, fichier, categorie=None):
        if categorie and categorie not in CATEGORIE_PHOTO:
            raise Exception(f"Catégorie invalide : {categorie}")

        self.chantier   = chantier
        self.user       = user
        self.fichier    = fichier
        self.categorie  = categorie
        self.date_prise = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.est_supprimee = False

    def supprimer(self, deleted_by, raison):
        if not deleted_by.peut("SUPPRIMER_PHOTO"):
            raise Exception("Permission refusée : rôle insuffisant")
        if not deleted_by.isActive:
            raise Exception("Compte utilisateur inactif")
        if not raison or raison.strip() == "":
            raise Exception("Une raison est obligatoire pour la suppression")
        if self.est_supprimee:
            raise Exception("Cette photo est déjà supprimée")

        self.est_supprimee = True

        log = LogPhoto(
            photo      = self,
            deleted_by = deleted_by,
            raison     = raison
        )
        return log

    def getUrl(self):
        return self.fichier

    def __repr__(self):
        statut = "SUPPRIMEE" if self.est_supprimee else "ACTIVE"
        return (f"Photo({self.user.prenom} | "
                f"{self.categorie} | {self.date_prise} | {statut})")


# ── LOGPHOTO ──────────────────────────────────────────────
class LogPhoto:

    def __init__(self, photo, deleted_by, raison):
        self.photo            = photo
        self.deleted_by       = deleted_by
        self.raison           = raison
        self.date_suppression = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def getDetails(self):
        return (f"[LOG] Photo supprimée par {self.deleted_by.prenom} "
                f"{self.deleted_by.nom} le {self.date_suppression} "
                f"| Raison : {self.raison}")

    def __repr__(self):
        return self.getDetails()


# TESTS
if __name__ == "__main__":


    # ── Setup : les users ──────────────────────────────────
    chef       = User(1, "Diallo",  "Moussa", "hash1", "CHEF_PROJET", "0700000001")
    technicien = User(2, "Kouamé",  "Jean",   "hash2", "TECHNICIEN",  "0700000002")
    direction  = User(3, "Konan",   "Aya",    "hash3", "DIRECTION",   "0700000003")

    # ── Projet ────────────────────────────────────────────
    print("\n── Création Projet ──")
    projet = Projet(
        id=1, nom="Rénovation Plateau", adresse="Rue de Lyon",
        description="Rénovation complète", ville="Abidjan",
        date_debut="2026-01-01", date_fin="2026-12-31",
        budget_total=50_000_000, chef_projet=chef, created_by=chef
    )
    print(projet)

    # ── Chantier ──────────────────────────────────────────
    print("\n── Création Chantier ──")
    chantier = Chantier(
        id=1, projet=projet, nom="Bâtiment A",
        localisation=(5.3600, -4.0083),
        adresse="Rue de Lyon, Abidjan",
        description="Rénovation bâtiment principal",
        date_debut="2026-02-01", date_fin="2026-10-31",
        superficie=500, budget_alloue=20_000_000,
        chef_projet=chef, created_by=chef
    )
    projet.ajouterChantier(chantier)
    print(chantier)
    print("Budget consommé :", projet.getBudgetConsomme())  # 20 000 000
    print("Budget restant  :", projet.getBudgetRestant())   # 30 000 000

    # ── Equipe ────────────────────────────────────────────
    print("\n── Création Equipe ──")
    equipe = Equipe(id=1, nom="Equipe A", chantier=chantier, created_by=chef)
    equipe.ajouterMembre(technicien, "MEMBRE")
    chantier.assignerEquipe(equipe)
    print(equipe)
    print("Contient technicien ?", equipe.contientUser(technicien))  # True

    # ── Pointage valide ───────────────────────────────────
    print("\n── Pointage Arrivée (valide) ──")
    arrivee = technicien.pointer(chantier, "ARRIVEE", 5.3612, -4.0091)
    chantier.ajouterPointage(arrivee)
    print(arrivee)
    print("Est valide ?", arrivee.estValide())                          # True
    print("Présences aujourd'hui :",
          chantier.calculerPresencesJour(arrivee.date_pointage))        # 1

    # ── Pointage refusé (trop loin) ───────────────────────
    print("\n── Pointage Refusé (trop loin) ──")
    try:
        technicien.pointer(chantier, "ARRIVEE", 5.4200, -4.1000)
    except Exception as e:
        print("Erreur attendue :", e)

    # ── Photo ─────────────────────────────────────────────
    print("\n── Prise de Photo ──")
    photo = technicien.prendrePhoto(chantier, "photo_avancement.jpg", "AVANCEMENT")
    chantier.ajouterPhoto(photo)
    print(photo)

    # ── Suppression Photo ─────────────────────────────────
    print("\n── Suppression Photo par Chef ──")
    log = photo.supprimer(chef, "Photo floue, ne respecte pas les standards")
    print(log)

    # ── Tentative suppression par technicien ──────────────
    print("\n── Suppression refusée (technicien) ──")
    photo2 = technicien.prendrePhoto(chantier, "photo2.jpg", "INCIDENT")
    try:
        photo2.supprimer(technicien, "Test")
    except Exception as e:
        print("Erreur attendue :", e)

    # ── Historique pointages technicien ───────────────────
    print("\n── Historique Pointages ──")
    historique = technicien.getHistoriquePointages(chantier)
    for p in historique:
        print(p)

    # ── Techniciens présents (vue chef) ───────────────────
    print("\n── Techniciens Présents ──")
    presents = chantier.getTechniciensPresents(arrivee.date_pointage)
    for u in presents:
        print(u)

    # ── Pointage DEPART ───────────────────────────────────
    print("\n── Pointage Départ ──")
    depart = technicien.pointer(chantier, "DEPART", 5.3612, -4.0091)
    chantier.ajouterPointage(depart)
    print(depart)
    print("Durée session :", depart.getDureeSession(arrivee))

    # ── Double arrivée refusée ────────────────────────────
    print("\n── Double Arrivée Refusée ──")
    arrivee2 = technicien.pointer(chantier, "ARRIVEE", 5.3612, -4.0091)
    chantier.ajouterPointage(arrivee2)
    try:
        technicien.pointer(chantier, "ARRIVEE", 5.3612, -4.0091)
    except Exception as e:
        print("Erreur attendue :", e)

    # ── Export données RH ─────────────────────────────────
    print("\n── Export Données ──")
    rh = User(4, "Bamba", "Fatou", "hash4", "RH", "0700000004")
    export = rh.exporterDonnees(chantier, mois=4, annee=2026)
    for ligne in export:
        print(ligne)
