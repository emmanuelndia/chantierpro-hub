import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";

const outputDir = path.join(process.cwd(), "docs", "guides-utilisation-pdf-roles-avec-ecrans");
const screenAssetsDir = path.join(process.cwd(), "docs", "guide-utilisation-roles", "assets");
const flowPhotosDir = path.join(outputDir, "photos-parcours");

const commonScreens = {
  supervisor: [
    { title: "Accueil terrain", file: "sup-mobile-accueil.jpeg" },
    { title: "Pointage chantier", file: "sup-mobile-pointage.jpeg" },
    { title: "Photo chantier", file: "sup-mobile-photo.jpeg" },
    { title: "Rapport de session", file: "sup-mobile-rapport-session.jpeg" },
  ],
  coordinator: [
    { title: "Tableau de bord web", file: "coord-web-dashboard.png" },
    { title: "Rapports web", file: "coord-web-rapports.png" },
    { title: "Accueil mobile", file: "coord-mobile-accueil.jpeg" },
    { title: "Rapports mobile", file: "coord-mobile-rapports.jpeg" },
  ],
  generalSupervisor: [
    { title: "Planning web", file: "gs-web-planning.png" },
    { title: "Creation de tache", file: "gs-web-ajout-tache.png" },
    { title: "Accueil mobile", file: "gs-mobile-accueil.jpeg" },
    { title: "Planning mobile", file: "gs-mobile-planning.jpeg" },
  ],
  projectManager: [
    { title: "Mes projets", file: "pm-web-mes-projets.png" },
    { title: "Detail projet", file: "pm-web-detail-projet.png" },
    { title: "Planning", file: "pm-web-planning.png" },
    { title: "Projets mobile", file: "pm-mobile-projets.jpeg" },
  ],
  direction: [
    { title: "Tableau de bord", file: "dir-web-dashboard.png" },
    { title: "Tous les projets", file: "dir-web-tous-projets.png" },
    { title: "Presences RH", file: "dir-web-presences-rh.png" },
    { title: "Accueil mobile", file: "dir-mobile-accueil.jpeg" },
  ],
  businessManager: [
    { title: "Tableau de bord manager", file: "gs-web-dashboard.png" },
    { title: "Planning web", file: "gs-web-planning.png" },
    { title: "Ajout de tache", file: "gs-web-ajout-tache.png" },
    { title: "Planning mobile", file: "gs-mobile-planning.jpeg" },
  ],
  hr: [
    { title: "Presences RH", file: "dir-web-presences-rh.png" },
    { title: "Tableau de bord", file: "dir-web-dashboard.png" },
  ],
  admin: [
    { title: "Tableau de bord", file: "dir-web-dashboard.png" },
    { title: "Projets", file: "dir-web-tous-projets.png" },
    { title: "Presences RH", file: "dir-web-presences-rh.png" },
    { title: "Logs", file: "dir-web-logs.png" },
  ],
};

const guides = [
  {
    file: "guide-superviseur.pdf",
    slug: "superviseur",
    title: "Superviseur",
    intro:
      "Le superviseur travaille principalement sur mobile. Il consulte ses chantiers du jour, pointe sa presence, prend des photos et transmet ses rapports de session.",
    web: [
      {
        name: "Mon profil",
        purpose: "Consulter et mettre a jour les informations personnelles du compte.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil terrain",
        purpose: "Voir le chantier du jour et les taches bureau eventuelles.",
        actions: ["Consulter le chantier du jour", "Ouvrir le pointage", "Verifier les taches du jour"],
      },
      {
        name: "Pointer",
        purpose: "Enregistrer les entrees, sorties et pauses sur chantier.",
        actions: ["Pointer l'entree", "Pointer la sortie", "Demarrer ou terminer une pause"],
      },
      {
        name: "Photo",
        purpose: "Envoyer des photos de chantier avec commentaire et tags rapides.",
        actions: ["Prendre une photo", "Ajouter un commentaire", "Ajouter un tag", "Lier la photo a une tache"],
      },
      {
        name: "Historique",
        purpose: "Consulter ses anciennes presences, photos et rapports.",
        actions: ["Voir l'historique", "Ouvrir un detail", "Envoyer un rapport tardif"],
      },
      {
        name: "Rapport session",
        purpose: "Rediger ou completer le rapport apres une intervention.",
        actions: ["Saisir un compte rendu", "Joindre un fichier en ligne", "Declarer la progression"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte depuis le mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Pointer sur un chantier",
        slug: "pointer-sur-un-chantier",
        steps: [
          "Se connecter avec son identifiant.",
          "Ouvrir l'accueil terrain et verifier le chantier du jour.",
          "Verifier la position GPS et la distance au chantier.",
          "Pointer l'entree.",
          "En fin d'intervention, pointer la sortie.",
          "Resultat : la session est complete et les heures peuvent etre comptabilisees.",
        ],
      },
      {
        name: "Envoyer une photo",
        slug: "envoyer-une-photo",
        steps: [
          "Ouvrir l'ecran Photo.",
          "Selectionner le chantier ou la tache.",
          "Prendre la photo.",
          "Ajouter un commentaire et un tag si besoin.",
          "Envoyer la photo.",
          "Resultat : la photo est visible dans la galerie.",
        ],
      },
      {
        name: "Envoyer un rapport",
        slug: "envoyer-un-rapport",
        steps: [
          "Ouvrir le rapport de session apres la sortie.",
          "Remplir le texte, joindre un fichier, ou faire les deux.",
          "Verifier la progression et le blocage eventuel.",
          "Soumettre le rapport.",
          "Resultat : le rapport est transmis aux personnes de suivi.",
        ],
      },
    ],
    tips: [
      "Toujours verifier le chantier selectionne avant de pointer.",
      "Pointer la sortie avant de changer de chantier.",
      "Ajouter un commentaire court aux photos importantes.",
    ],
    screenshots: commonScreens.supervisor,
  },
  {
    file: "guide-ressource.pdf",
    slug: "ressource",
    title: "Ressource",
    intro:
      "La ressource suit le meme parcours terrain qu'un superviseur. Elle execute les taches assignees, pointe sur les taches chantier et declare son avancement.",
    web: [
      {
        name: "Mon profil",
        purpose: "Consulter et mettre a jour les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil terrain",
        purpose: "Voir les chantiers et taches du jour.",
        actions: ["Consulter le chantier du jour", "Voir les taches bureau", "Ouvrir le pointage"],
      },
      {
        name: "Pointer",
        purpose: "Enregistrer la presence sur les taches chantier.",
        actions: ["Pointer l'entree", "Pointer la sortie", "Gerer les pauses"],
      },
      {
        name: "Photo",
        purpose: "Ajouter des preuves photos sur chantier.",
        actions: ["Prendre une photo", "Commenter", "Ajouter un tag", "Lier a une tache"],
      },
      {
        name: "Historique",
        purpose: "Retrouver les anciennes interventions.",
        actions: ["Consulter les presences", "Ouvrir les details", "Envoyer un rapport tardif"],
      },
      {
        name: "Rapport session",
        purpose: "Transmettre le compte rendu d'intervention.",
        actions: ["Rediger le rapport", "Ajouter un fichier en ligne", "Declarer un blocage"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Executer une tache terrain",
        slug: "executer-une-tache-terrain",
        steps: [
          "Se connecter sur mobile.",
          "Consulter le chantier du jour.",
          "Pointer l'entree si la tache est sur chantier.",
          "Realiser la tache.",
          "Mettre a jour l'avancement.",
          "Prendre des photos de preuve si necessaire.",
          "Pointer la sortie et envoyer le rapport.",
          "Resultat : la tache, les heures, les photos et le rapport sont traces.",
        ],
      },
      {
        name: "Declarer une tache bureau",
        slug: "declarer-une-tache-bureau",
        steps: [
          "Ouvrir l'accueil terrain.",
          "Consulter la section Taches bureau du jour.",
          "Mettre a jour l'avancement.",
          "Ajouter un commentaire ou un blocage si besoin.",
          "Resultat : la tache bureau est suivie sans pointage chantier obligatoire.",
        ],
      },
    ],
    tips: [
      "Les taches bureau ne demandent pas de pointage chantier.",
      "Mettre a jour l'avancement pendant la journee.",
      "Utiliser les tags photo pour faciliter le suivi.",
    ],
    screenshots: commonScreens.supervisor,
  },
  {
    file: "guide-coordinateur.pdf",
    slug: "coordinateur",
    title: "Coordinateur",
    intro:
      "Le coordinateur suit les rapports, les alertes et les presences. Il peut aussi intervenir sur mobile comme une ressource terrain lorsqu'il est assigne.",
    web: [
      {
        name: "Tableau de bord coordinateur",
        purpose: "Voir les priorites et les rapports a traiter.",
        actions: ["Consulter les indicateurs", "Ouvrir les rapports en attente", "Suivre les alertes"],
      },
      {
        name: "Rapports terrain",
        purpose: "Suivre et traiter les rapports accessibles.",
        actions: ["Filtrer les rapports", "Ouvrir un rapport", "Valider pour client", "Relancer un superviseur"],
      },
      {
        name: "Presences equipe",
        purpose: "Consulter les presences des equipes suivies.",
        actions: ["Filtrer les presences", "Ouvrir un detail", "Verifier les anomalies"],
      },
      {
        name: "Mon profil",
        purpose: "Gerer les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil coordinateur",
        purpose: "Voir les priorites operationnelles.",
        actions: ["Voir les alertes", "Ouvrir les rapports", "Voir les taches si assigne"],
      },
      {
        name: "Rapports",
        purpose: "Traiter rapidement les rapports terrain.",
        actions: ["Lister les rapports", "Ouvrir un detail", "Valider", "Relancer"],
      },
      {
        name: "Pointer",
        purpose: "Pointer si le coordinateur intervient sur chantier.",
        actions: ["Pointer l'entree", "Pointer la sortie", "Gerer les pauses"],
      },
      {
        name: "Photo",
        purpose: "Ajouter une photo si une intervention terrain le demande.",
        actions: ["Prendre une photo", "Ajouter un commentaire", "Ajouter un tag"],
      },
      {
        name: "Historique",
        purpose: "Consulter l'historique terrain personnel.",
        actions: ["Voir l'historique", "Ouvrir un detail"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Traiter un rapport terrain",
        slug: "traiter-un-rapport-terrain",
        steps: [
          "Ouvrir les rapports terrain.",
          "Filtrer les rapports en attente.",
          "Ouvrir le detail du rapport.",
          "Lire le texte, les fichiers et les photos.",
          "Valider pour client si le rapport est correct.",
          "Resultat : le rapport est pret pour le suivi client.",
        ],
      },
      {
        name: "Relancer un superviseur",
        slug: "relancer-un-superviseur",
        steps: [
          "Ouvrir les rapports en attente.",
          "Identifier le rapport manquant ou incomplet.",
          "Utiliser l'action de relance.",
          "Confirmer la relance.",
          "Resultat : la relance est enregistree.",
        ],
      },
    ],
    tips: [
      "Prioriser les rapports en attente.",
      "Verifier les pieces jointes et les photos avant validation.",
      "Utiliser les filtres pour aller plus vite.",
    ],
    screenshots: commonScreens.coordinator,
  },
  {
    file: "guide-superviseur-general.pdf",
    slug: "superviseur-general",
    title: "Superviseur general",
    intro:
      "Le superviseur general organise le planning des sites qui lui sont confies et suit les rapports, photos et presences de son perimetre.",
    web: [
      {
        name: "Tableau de bord manager",
        purpose: "Voir les indicateurs et alertes du perimetre.",
        actions: ["Consulter les indicateurs", "Ouvrir le planning", "Ouvrir les rapports"],
      },
      {
        name: "Planning",
        purpose: "Planifier les ressources sur les sites confies.",
        actions: ["Voir le jour", "Voir la semaine", "Creer une tache", "Modifier une tache", "Supprimer une tache"],
      },
      {
        name: "Rapports terrain",
        purpose: "Consulter les rapports des sites suivis.",
        actions: ["Filtrer", "Ouvrir un detail", "Exporter"],
      },
      {
        name: "Presences equipe",
        purpose: "Suivre les presences des ressources.",
        actions: ["Voir les presences", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Perimetres",
        purpose: "Consulter les sites confies.",
        actions: ["Voir les perimetres", "Consulter un detail"],
      },
      {
        name: "Equipes",
        purpose: "Gerer les equipes du perimetre.",
        actions: ["Creer une equipe", "Modifier une equipe", "Ajouter ou retirer un membre"],
      },
      {
        name: "Mon profil",
        purpose: "Gerer les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil manager",
        purpose: "Voir une synthese operationnelle.",
        actions: ["Voir les indicateurs", "Voir les alertes", "Ouvrir le planning"],
      },
      {
        name: "Planning",
        purpose: "Gerer les taches depuis mobile.",
        actions: ["Voir le planning", "Creer une tache", "Modifier ou supprimer une tache"],
      },
      {
        name: "Galerie",
        purpose: "Consulter les photos du perimetre.",
        actions: ["Voir les photos", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Pointer",
        purpose: "Pointer si le superviseur general est lui-meme assigne sur chantier.",
        actions: ["Pointer l'entree", "Pointer la sortie", "Gerer les pauses"],
      },
      {
        name: "Photo",
        purpose: "Envoyer une photo si besoin.",
        actions: ["Prendre une photo", "Commenter", "Ajouter un tag"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Creer une tache planning",
        slug: "creer-une-tache-planning",
        steps: [
          "Ouvrir le planning.",
          "Choisir la date.",
          "Selectionner un chantier du perimetre.",
          "Selectionner une ressource.",
          "Renseigner l'action du jour.",
          "Choisir le type de tache.",
          "Enregistrer.",
          "Resultat : la ressource voit la tache sur mobile.",
        ],
      },
      {
        name: "Suivre les rapports",
        slug: "suivre-les-rapports",
        steps: [
          "Ouvrir les rapports terrain.",
          "Filtrer par date, chantier ou ressource.",
          "Ouvrir un rapport.",
          "Lire le texte, les photos, les fichiers et la progression.",
          "Resultat : l'execution terrain est suivie.",
        ],
      },
    ],
    tips: [
      "Verifier le bon chantier avant de creer une tache.",
      "Suivre les presences pour confirmer que les ressources sont bien sur site.",
      "Utiliser les rapports et photos ensemble pour comprendre l'avancement.",
    ],
    screenshots: commonScreens.generalSupervisor,
  },
];

const businessManagers = [
  {
    file: "guide-responsable-bureau-etude.pdf",
    title: "Responsable Bureau d'etude",
    unit: "Bureau d'etude",
    resource: "ressource Bureau d'etude",
  },
  {
    file: "guide-responsable-negociation.pdf",
    title: "Responsable Negociation",
    unit: "negociation",
    resource: "ressource negociation",
  },
  {
    file: "guide-responsable-parc-auto.pdf",
    title: "Responsable Parc Auto",
    unit: "parc auto",
    resource: "chauffeur",
  },
];

const businessResources = [
  {
    file: "guide-ressource-bureau-etude.pdf",
    title: "Ressource Bureau d'etude",
    unit: "Bureau d'etude",
  },
  {
    file: "guide-ressource-negociation.pdf",
    title: "Ressource Negociation",
    unit: "negociation",
  },
  {
    file: "guide-chauffeur.pdf",
    title: "Chauffeur",
    unit: "parc auto",
  },
];

for (const manager of businessManagers) {
  guides.push({
    file: manager.file,
    slug: manager.file.replace(/^guide-/, "").replace(/\.pdf$/, ""),
    title: manager.title,
    intro: `Ce role planifie les ${manager.resource}s sur les projets et chantiers actifs. Il suit ensuite les rapports, photos et presences lies aux interventions de son equipe.`,
    web: [
      {
        name: "Tableau de bord manager metier",
        purpose: `Voir la synthese operationnelle ${manager.unit}.`,
        actions: ["Consulter les indicateurs", "Voir les alertes", "Ouvrir le planning"],
      },
      {
        name: "Planning",
        purpose: `Planifier les ${manager.resource}s.`,
        actions: ["Voir le planning", "Creer une tache", "Modifier une tache", "Supprimer une tache", "Exporter le planning"],
      },
      {
        name: "Galerie photos",
        purpose: "Consulter les photos des interventions suivies.",
        actions: ["Voir les photos", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Rapports terrain",
        purpose: "Consulter les rapports des interventions suivies.",
        actions: ["Lister les rapports", "Filtrer", "Ouvrir un detail", "Exporter"],
      },
      {
        name: "Presences equipe",
        purpose: "Suivre les presences de son equipe.",
        actions: ["Voir les presences", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Mon profil",
        purpose: "Gerer les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil manager",
        purpose: `Voir les indicateurs ${manager.unit}.`,
        actions: ["Voir les indicateurs", "Voir les alertes", "Ouvrir le planning"],
      },
      {
        name: "Planning",
        purpose: "Gerer les taches depuis mobile.",
        actions: ["Voir le planning", "Creer une tache", "Modifier ou supprimer une tache"],
      },
      {
        name: "Galerie",
        purpose: "Consulter les photos accessibles.",
        actions: ["Voir les photos", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: `Planifier une ${manager.resource}`,
        slug: "planifier-une-ressource",
        steps: [
          "Ouvrir le planning.",
          "Choisir un projet ou un chantier actif.",
          `Selectionner une ${manager.resource}.`,
          "Renseigner la tache a realiser.",
          "Choisir si la tache est sur chantier ou bureau.",
          "Enregistrer.",
          "Resultat : la ressource voit la tache sur mobile.",
        ],
      },
      {
        name: "Suivre l'activite de l'equipe",
        slug: "suivre-activite-equipe",
        steps: [
          "Ouvrir le tableau de bord.",
          "Consulter les alertes et indicateurs.",
          "Ouvrir les rapports, photos ou presences.",
          "Filtrer par date, chantier ou ressource.",
          "Resultat : l'activite de l'equipe est suivie.",
        ],
      },
    ],
    tips: [
      "Verifier la disponibilite de la ressource avant d'assigner une tache.",
      "Choisir correctement entre tache chantier et tache bureau.",
      "Consulter les rapports et photos pour confirmer l'avancement.",
    ],
    screenshots: commonScreens.businessManager,
  });
}

for (const resource of businessResources) {
  guides.push({
    file: resource.file,
    slug: resource.file.replace(/^guide-/, "").replace(/\.pdf$/, ""),
    title: resource.title,
    intro: `Ce role execute les taches ${resource.unit} assignees. Les taches chantier demandent un pointage, tandis que les taches bureau restent visibles sans pointage obligatoire.`,
    web: [
      {
        name: "Mon profil",
        purpose: "Consulter et mettre a jour les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil terrain",
        purpose: "Voir les taches du jour.",
        actions: ["Voir le chantier du jour", "Voir les taches bureau", "Ouvrir le pointage"],
      },
      {
        name: "Pointer",
        purpose: "Pointer sur les taches chantier.",
        actions: ["Pointer l'entree", "Pointer la sortie", "Gerer les pauses"],
      },
      {
        name: "Photo",
        purpose: "Envoyer des photos liees aux taches.",
        actions: ["Prendre une photo", "Ajouter un tag", "Ajouter un commentaire", "Lier a une tache"],
      },
      {
        name: "Historique",
        purpose: "Consulter l'historique personnel.",
        actions: ["Voir l'historique", "Ouvrir un detail", "Envoyer un rapport tardif"],
      },
      {
        name: "Rapport session",
        purpose: "Transmettre le compte rendu d'intervention.",
        actions: ["Saisir le rapport", "Joindre un fichier en ligne", "Declarer l'avancement"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Realiser une tache chantier",
        slug: "realiser-une-tache-chantier",
        steps: [
          "Ouvrir l'accueil terrain.",
          "Consulter la tache du jour.",
          "Pointer l'entree si la tache demande une presence chantier.",
          "Realiser l'action demandee.",
          "Prendre une photo si necessaire.",
          "Mettre a jour l'avancement.",
          "Pointer la sortie et envoyer le rapport.",
          "Resultat : l'intervention est tracee.",
        ],
      },
      {
        name: "Suivre une tache bureau",
        slug: "suivre-une-tache-bureau",
        steps: [
          "Ouvrir les taches bureau du jour.",
          "Lire l'action demandee.",
          "Mettre a jour l'avancement.",
          "Ajouter un commentaire ou un blocage si besoin.",
          "Resultat : la tache est suivie sans pointage chantier.",
        ],
      },
    ],
    tips: [
      "Pointer seulement pour les taches chantier.",
      "Declarer rapidement les blocages.",
      "Ajouter une photo quand elle aide a prouver l'avancement.",
    ],
    screenshots: commonScreens.supervisor,
  });
}

guides.push(
  {
    file: "guide-chef-projet.pdf",
    slug: "chef-projet",
    title: "Chef de projet",
    intro:
      "Le chef de projet cree et suit ses projets, gere les chantiers, planifie les ressources et consulte les preuves terrain.",
    web: [
      {
        name: "Tableau de bord chef projet",
        purpose: "Voir les indicateurs des projets.",
        actions: ["Consulter les indicateurs", "Ouvrir les projets", "Ouvrir le planning"],
      },
      {
        name: "Mes projets",
        purpose: "Voir et creer les projets suivis.",
        actions: ["Voir les projets", "Creer un projet", "Ouvrir un detail"],
      },
      {
        name: "Detail projet",
        purpose: "Gerer le projet, les chantiers et les documents.",
        actions: ["Modifier le projet", "Creer un chantier", "Importer des chantiers", "Ajouter un document"],
      },
      {
        name: "Planning",
        purpose: "Planifier les ressources sur les chantiers.",
        actions: ["Voir le jour", "Voir la semaine", "Voir le centralise", "Creer ou modifier une tache"],
      },
      {
        name: "Perimetres GS",
        purpose: "Confier des sites aux superviseurs generaux.",
        actions: ["Creer un perimetre", "Modifier un perimetre", "Cloturer un perimetre"],
      },
      {
        name: "Galerie photos",
        purpose: "Consulter les photos des projets.",
        actions: ["Filtrer les photos", "Ouvrir un detail", "Supprimer avec motif si necessaire"],
      },
      {
        name: "Rapports terrain",
        purpose: "Consulter les rapports des projets.",
        actions: ["Filtrer", "Ouvrir un detail", "Exporter"],
      },
      {
        name: "Presences equipe",
        purpose: "Suivre les presences des ressources.",
        actions: ["Voir les presences", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Mon profil",
        purpose: "Gerer les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil chef projet",
        purpose: "Voir une synthese mobile des projets.",
        actions: ["Voir les indicateurs", "Voir les sites actifs", "Ouvrir les alertes"],
      },
      {
        name: "Projets",
        purpose: "Consulter et creer des projets.",
        actions: ["Voir les projets", "Creer un projet", "Ouvrir un detail"],
      },
      {
        name: "Sites",
        purpose: "Gerer les sites depuis mobile.",
        actions: ["Voir les sites", "Creer un site", "Modifier un site"],
      },
      {
        name: "Planning",
        purpose: "Gerer les taches courantes.",
        actions: ["Voir le planning", "Creer une tache", "Modifier ou supprimer une tache"],
      },
      {
        name: "Galerie",
        purpose: "Consulter les photos accessibles.",
        actions: ["Voir les photos", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Presences",
        purpose: "Consulter les presences depuis mobile.",
        actions: ["Voir les presences", "Filtrer"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Creer un chantier",
        slug: "creer-un-chantier",
        steps: [
          "Ouvrir le detail du projet.",
          "Cliquer sur Nouveau chantier.",
          "Renseigner le nom, l'adresse ou le repere.",
          "Positionner le point GPS.",
          "Renseigner les dates, la surface et le responsable.",
          "Ajouter une limite precise si besoin.",
          "Enregistrer.",
          "Resultat : le chantier est cree dans le projet.",
        ],
      },
      {
        name: "Importer des chantiers",
        slug: "importer-des-chantiers",
        steps: [
          "Ouvrir le detail du projet.",
          "Choisir Importer des chantiers.",
          "Telecharger le modele Excel.",
          "Remplir puis charger le fichier.",
          "Verifier la previsualisation.",
          "Importer les lignes valides.",
          "Resultat : plusieurs chantiers sont crees rapidement.",
        ],
      },
      {
        name: "Planifier une ressource",
        slug: "planifier-une-ressource",
        steps: [
          "Ouvrir le planning.",
          "Choisir le chantier.",
          "Selectionner une ressource.",
          "Verifier si elle est deja occupee.",
          "Renseigner la tache.",
          "Enregistrer.",
          "Resultat : la ressource voit la tache sur mobile.",
        ],
      },
    ],
    tips: [
      "Verifier les coordonnees GPS avant de creer un chantier.",
      "Utiliser l'import Excel quand il y a beaucoup de chantiers.",
      "Consulter le planning centralise avant d'assigner une ressource tres demandee.",
    ],
    screenshots: commonScreens.projectManager,
  },
  {
    file: "guide-direction.pdf",
    slug: "direction",
    title: "Direction",
    intro:
      "La direction dispose d'une vision globale de l'activite. Elle suit les projets, les presences, les rapports, les photos et les indicateurs.",
    web: [
      {
        name: "Tableau de bord direction",
        purpose: "Voir l'activite globale.",
        actions: ["Voir les indicateurs", "Voir les alertes", "Ouvrir les projets", "Ouvrir le suivi RH"],
      },
      {
        name: "Tous les projets",
        purpose: "Consulter et gerer les projets.",
        actions: ["Voir les projets", "Creer un projet", "Ouvrir un detail"],
      },
      {
        name: "Planning",
        purpose: "Consulter le planning global.",
        actions: ["Voir le planning", "Voir le centralise", "Exporter"],
      },
      {
        name: "Presences RH",
        purpose: "Suivre les temps et traiter les anomalies.",
        actions: ["Filtrer les presences", "Exporter", "Regulariser une session"],
      },
      {
        name: "Presences chantiers",
        purpose: "Suivre les presences en direct sur les chantiers.",
        actions: ["Voir le live", "Filtrer", "Voir les anomalies", "Actualiser"],
      },
      {
        name: "Galerie photos",
        purpose: "Consulter les photos globales.",
        actions: ["Filtrer", "Ouvrir un detail", "Supprimer avec motif si necessaire"],
      },
      {
        name: "Rapports terrain",
        purpose: "Consulter les rapports terrain.",
        actions: ["Lister les rapports", "Filtrer", "Ouvrir un detail", "Exporter"],
      },
      {
        name: "Logs de suppression",
        purpose: "Consulter les actions sensibles tracees.",
        actions: ["Voir les logs", "Filtrer"],
      },
      {
        name: "Mon profil",
        purpose: "Gerer les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil direction",
        purpose: "Voir une synthese mobile globale.",
        actions: ["Voir les indicateurs", "Voir les sites actifs", "Ouvrir les alertes"],
      },
      {
        name: "Projets",
        purpose: "Consulter les projets.",
        actions: ["Voir les projets", "Creer un projet", "Ouvrir un detail"],
      },
      {
        name: "Sites",
        purpose: "Consulter et gerer les sites.",
        actions: ["Voir les sites", "Creer un site", "Modifier un site"],
      },
      {
        name: "Galerie",
        purpose: "Consulter les photos.",
        actions: ["Voir les photos", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Presences",
        purpose: "Consulter les presences depuis mobile.",
        actions: ["Voir les presences", "Filtrer"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Suivre l'activite globale",
        slug: "suivre-activite-globale",
        steps: [
          "Ouvrir le tableau de bord.",
          "Consulter les indicateurs globaux.",
          "Ouvrir les projets, rapports, photos ou presences selon le besoin.",
          "Utiliser les filtres pour isoler un projet ou une periode.",
          "Resultat : la direction obtient une vue consolidee de l'activite.",
        ],
      },
      {
        name: "Regulariser une presence",
        slug: "regulariser-une-presence",
        steps: [
          "Ouvrir les presences RH.",
          "Filtrer les sessions a traiter.",
          "Ouvrir une session anormale.",
          "Saisir l'heure corrigee et un commentaire.",
          "Confirmer.",
          "Resultat : la correction est enregistree.",
        ],
      },
    ],
    tips: [
      "Utiliser les filtres par projet pour analyser plus vite.",
      "Traiter les anomalies RH avant les exports.",
      "Consulter les logs pour les actions sensibles.",
    ],
    screenshots: commonScreens.direction,
  },
  {
    file: "guide-rh.pdf",
    slug: "rh",
    title: "Ressources humaines",
    intro:
      "Le role RH suit les presences, controle les heures, traite les anomalies et prepare les exports.",
    web: [
      {
        name: "Tableau de bord RH",
        purpose: "Voir les indicateurs RH.",
        actions: ["Voir les indicateurs", "Ouvrir les presences", "Ouvrir les exports"],
      },
      {
        name: "Presences RH",
        purpose: "Controler les temps et anomalies de presence.",
        actions: ["Filtrer les presences", "Ouvrir une ressource", "Regulariser une session"],
      },
      {
        name: "Presences chantiers",
        purpose: "Voir les presences en direct par chantier.",
        actions: ["Voir le live", "Filtrer par projet ou chantier", "Voir les anomalies", "Actualiser"],
      },
      {
        name: "Export RH",
        purpose: "Generer et telecharger les exports RH.",
        actions: ["Creer un export", "Voir l'historique", "Telecharger un fichier"],
      },
      {
        name: "Mon profil",
        purpose: "Gerer les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil",
        purpose: "Afficher l'accueil mobile RH.",
        actions: ["Voir le resume", "Ouvrir le profil"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Suivre les presences",
        slug: "suivre-les-presences",
        steps: [
          "Ouvrir les presences RH.",
          "Filtrer par periode, ressource ou projet.",
          "Consulter les sessions et durees.",
          "Identifier les anomalies.",
          "Resultat : les heures de travail sont controlees.",
        ],
      },
      {
        name: "Regulariser une session",
        slug: "regulariser-une-session",
        steps: [
          "Ouvrir une session a traiter.",
          "Renseigner une heure de sortie corrigee.",
          "Ajouter un commentaire.",
          "Valider.",
          "Resultat : la regularisation est tracee avec auteur et date.",
        ],
      },
      {
        name: "Exporter les donnees",
        slug: "exporter-les-donnees",
        steps: [
          "Ouvrir l'export RH.",
          "Choisir la periode et les filtres.",
          "Lancer l'export.",
          "Telecharger le fichier genere.",
          "Resultat : les donnees RH sont disponibles.",
        ],
      },
    ],
    tips: [
      "Verifier les sessions incompletes avant export.",
      "Toujours mettre un commentaire clair lors d'une regularisation.",
      "Utiliser le live chantier pour suivre la journee en cours.",
    ],
    screenshots: commonScreens.hr,
  },
  {
    file: "guide-administrateur.pdf",
    slug: "administrateur",
    title: "Administrateur",
    intro:
      "L'administrateur gere les utilisateurs, les projets, les donnees globales et les actions sensibles de l'application.",
    web: [
      {
        name: "Tableau de bord admin",
        purpose: "Voir les indicateurs d'administration.",
        actions: ["Voir les indicateurs", "Voir les alertes", "Ouvrir les utilisateurs", "Ouvrir les logs"],
      },
      {
        name: "Utilisateurs",
        purpose: "Gerer les comptes utilisateurs.",
        actions: ["Creer un utilisateur", "Modifier un utilisateur", "Activer ou desactiver", "Reinitialiser un mot de passe"],
      },
      {
        name: "Tous les projets",
        purpose: "Consulter et gerer les projets.",
        actions: ["Voir les projets", "Creer un projet", "Modifier un projet"],
      },
      {
        name: "Planning",
        purpose: "Consulter le planning global.",
        actions: ["Voir le planning", "Voir le centralise", "Exporter"],
      },
      {
        name: "Presences RH",
        purpose: "Suivre et corriger les presences.",
        actions: ["Filtrer", "Exporter", "Regulariser une session"],
      },
      {
        name: "Presences chantiers",
        purpose: "Voir le suivi live des presences chantier.",
        actions: ["Voir le live", "Filtrer", "Voir les anomalies", "Actualiser"],
      },
      {
        name: "Galerie photos",
        purpose: "Consulter et gerer les photos.",
        actions: ["Filtrer", "Ouvrir un detail", "Supprimer avec motif si necessaire"],
      },
      {
        name: "Rapports terrain",
        purpose: "Consulter les rapports globaux.",
        actions: ["Lister les rapports", "Filtrer", "Ouvrir un detail", "Exporter"],
      },
      {
        name: "Logs",
        purpose: "Consulter les actions sensibles.",
        actions: ["Voir les logs", "Filtrer", "Exporter"],
      },
      {
        name: "Mon profil",
        purpose: "Gerer les informations personnelles.",
        actions: ["Modifier le nom", "Modifier l'email", "Changer le mot de passe"],
      },
    ],
    mobile: [
      {
        name: "Accueil admin",
        purpose: "Voir l'accueil mobile d'administration.",
        actions: ["Voir le resume", "Ouvrir les utilisateurs", "Ouvrir les logs"],
      },
      {
        name: "Utilisateurs",
        purpose: "Gerer les comptes depuis mobile.",
        actions: ["Voir les utilisateurs", "Creer un utilisateur", "Modifier", "Activer ou desactiver"],
      },
      {
        name: "Logs",
        purpose: "Consulter les logs sur mobile.",
        actions: ["Voir les logs", "Filtrer"],
      },
      {
        name: "Galerie",
        purpose: "Consulter les photos accessibles.",
        actions: ["Voir les photos", "Filtrer", "Ouvrir un detail"],
      },
      {
        name: "Profil",
        purpose: "Gerer le compte mobile.",
        actions: ["Modifier les informations", "Changer le mot de passe", "Se deconnecter"],
      },
    ],
    flows: [
      {
        name: "Creer un utilisateur",
        slug: "creer-un-utilisateur",
        steps: [
          "Ouvrir Utilisateurs.",
          "Cliquer sur Nouvel utilisateur.",
          "Renseigner le nom, le prenom, l'identifiant, le role et l'email si disponible.",
          "Enregistrer.",
          "Communiquer l'identifiant et le mot de passe temporaire.",
          "Resultat : l'utilisateur peut se connecter et changer son mot de passe.",
        ],
      },
      {
        name: "Desactiver un utilisateur",
        slug: "desactiver-un-utilisateur",
        steps: [
          "Ouvrir la liste des utilisateurs.",
          "Selectionner l'utilisateur.",
          "Desactiver le compte.",
          "Verifier qu'il n'apparait plus dans les listes actives.",
          "Resultat : le compte ne peut plus utiliser l'application.",
        ],
      },
      {
        name: "Consulter les logs",
        slug: "consulter-les-logs",
        steps: [
          "Ouvrir les logs.",
          "Filtrer selon le besoin.",
          "Consulter les actions sensibles.",
          "Exporter si necessaire.",
          "Resultat : les actions importantes restent tracables.",
        ],
      },
    ],
    tips: [
      "Preferer la desactivation a la suppression d'un utilisateur.",
      "Verifier le role avant de creer un compte.",
      "Consulter les logs apres une action sensible.",
    ],
    screenshots: commonScreens.admin,
  },
);

function addWrapped(doc, text, x, y, maxWidth, lineHeight, options = {}) {
  const lines = doc.splitTextToSize(text, maxWidth);
  for (const line of lines) {
    if (y > 276) {
      doc.addPage();
      y = 24;
    }
    doc.text(line, x, y, options);
    y += lineHeight;
  }
  return y;
}

function addSectionTitle(doc, title, y) {
  if (y > 264) {
    doc.addPage();
    y = 24;
  }
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 74, 112);
  doc.setFontSize(14);
  doc.text(title, 18, y);
  doc.setDrawColor(20, 74, 112);
  doc.line(18, y + 3, 192, y + 3);
  doc.setTextColor(0, 0, 0);
  return y + 10;
}

function addScreens(doc, screens, y) {
  doc.setFontSize(11);
  for (const screen of screens) {
    if (y > 268) {
      doc.addPage();
      y = 24;
    }
    doc.setFont("helvetica", "bold");
    y = addWrapped(doc, screen.name, 20, y, 170, 5);
    doc.setFont("helvetica", "normal");
    y = addWrapped(doc, screen.purpose, 24, y, 165, 5);
    for (const action of screen.actions) {
      y = addWrapped(doc, `- ${action}`, 28, y, 160, 5);
    }
    y += 3;
  }
  return y;
}

function listFlowPhotos(roleSlug, flowSlug) {
  const dir = path.join(flowPhotosDir, roleSlug, flowSlug);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((file) => /\.(png|jpe?g)$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "fr"))
    .map((file) => ({
      title: path.parse(file).name.replace(/[-_]+/g, " "),
      filePath: path.join(dir, file),
    }));
}

function addFlowPhotos(doc, roleSlug, flowSlug, y) {
  const photos = listFlowPhotos(roleSlug, flowSlug);
  if (!photos.length) {
    return y;
  }

  if (y > 224) {
    doc.addPage();
    y = 24;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(20, 74, 112);
  y = addWrapped(doc, "Photos du parcours", 28, y + 2, 150, 5);
  doc.setTextColor(0, 0, 0);

  for (const photo of photos) {
    if (y > 220) {
      doc.addPage();
      y = 24;
    }

    const extension = path.extname(photo.filePath).toLowerCase();
    const format = extension === ".png" ? "PNG" : "JPEG";
    const imageData = fs.readFileSync(photo.filePath);
    const props = doc.getImageProperties(imageData);
    const maxWidth = 150;
    const maxHeight = 118;
    const ratio = Math.min(maxWidth / props.width, maxHeight / props.height);
    const width = props.width * ratio;
    const height = props.height * ratio;
    const x = 30 + (150 - width) / 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    y = addWrapped(doc, photo.title, 30, y, 150, 4.5);
    doc.addImage(imageData, format, x, y, width, height);
    y += height + 7;
  }

  return y;
}

function addFlows(doc, guide, y) {
  doc.setFontSize(11);
  for (const flow of guide.flows) {
    if (y > 260) {
      doc.addPage();
      y = 24;
    }
    doc.setFont("helvetica", "bold");
    y = addWrapped(doc, flow.name, 20, y, 170, 5);
    doc.setFont("helvetica", "normal");
    flow.steps.forEach((step, index) => {
      y = addWrapped(doc, `${index + 1}. ${step}`, 24, y, 165, 5);
    });
    y = addFlowPhotos(doc, guide.slug, flow.slug, y);
    y += 3;
  }
  return y;
}

function addScreenshots(doc, screenshots, y) {
  if (!screenshots?.length) {
    return y;
  }

  y = addSectionTitle(doc, "Quelques ecrans", y + 3);

  for (const screenshot of screenshots) {
    const imagePath = path.join(screenAssetsDir, screenshot.file);
    if (!fs.existsSync(imagePath)) {
      continue;
    }

    if (y > 220) {
      doc.addPage();
      y = 24;
    }

    const extension = path.extname(screenshot.file).toLowerCase();
    const format = extension === ".png" ? "PNG" : "JPEG";
    const imageData = fs.readFileSync(imagePath);
    const props = doc.getImageProperties(imageData);
    const maxWidth = format === "PNG" ? 168 : 78;
    const maxHeight = format === "PNG" ? 92 : 138;
    const ratio = Math.min(maxWidth / props.width, maxHeight / props.height);
    const width = props.width * ratio;
    const height = props.height * ratio;
    const x = format === "PNG" ? 21 : 66;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    y = addWrapped(doc, screenshot.title, 20, y, 170, 5);
    doc.addImage(imageData, format, x, y, width, height);
    y += height + 8;
  }

  return y;
}

function addFooter(doc) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    doc.text(`ChantierPro - Guide utilisateur - Page ${page}/${total}`, 18, 288);
    doc.setTextColor(0, 0, 0);
  }
}

function generateGuide(guide) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  doc.setFillColor(20, 74, 112);
  doc.rect(0, 0, 210, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(`Guide d'utilisation - ${guide.title}`, 18, 17);
  doc.setTextColor(0, 0, 0);

  let y = 40;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  y = addWrapped(doc, guide.intro, 18, y, 174, 6);

  y = addSectionTitle(doc, "Ce role sert a quoi ?", y + 6);
  y = addWrapped(doc, guide.intro, 20, y, 170, 6);

  y = addSectionTitle(doc, "Utilisation sur le web", y + 6);
  y = addScreens(doc, guide.web, y);

  y = addSectionTitle(doc, "Utilisation sur mobile", y + 3);
  y = addScreens(doc, guide.mobile, y);

  y = addSectionTitle(doc, "Parcours principaux", y + 3);
  y = addFlows(doc, guide, y);

  y = addScreenshots(doc, guide.screenshots, y);

  y = addSectionTitle(doc, "Conseils pratiques", y + 3);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  for (const tip of guide.tips) {
    y = addWrapped(doc, `- ${tip}`, 22, y, 168, 6);
  }

  addFooter(doc);
  doc.save(path.join(outputDir, guide.file));
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(flowPhotosDir, { recursive: true });

const flowPhotoInstructions = [
  "Photos de parcours utilisateur",
  "",
  "Glisse tes captures d'ecran dans les dossiers correspondant au role et au parcours.",
  "Formats acceptes : .png, .jpg, .jpeg",
  "Ordre d'affichage : ordre alphabetique des noms de fichiers.",
  "",
  "Exemple :",
  "photos-parcours/superviseur/pointer-sur-un-chantier/01-accueil.png",
  "photos-parcours/superviseur/pointer-sur-un-chantier/02-pointage-entree.png",
  "",
  "Apres ajout des images, relance :",
  "node scripts/generate-role-user-guides.mjs",
  "",
  "Les photos seront ajoutees dans la section Parcours principaux, sous le parcours correspondant.",
].join("\n");

fs.writeFileSync(path.join(flowPhotosDir, "README.txt"), flowPhotoInstructions, "utf8");

for (const guide of guides) {
  for (const flow of guide.flows) {
    const dir = path.join(flowPhotosDir, guide.slug, flow.slug);
    fs.mkdirSync(dir, { recursive: true });
    const gitkeep = path.join(dir, ".gitkeep");
    if (!fs.existsSync(gitkeep)) {
      fs.writeFileSync(gitkeep, "", "utf8");
    }
  }
}

for (const guide of guides) {
  generateGuide(guide);
}

const index = [
  "Guides PDF d'utilisation par role",
  "",
  "Fichiers generes :",
  ...guides.map((guide) => `- ${guide.title} : ${guide.file}`),
  "",
  "Ces guides sont rediges pour les utilisateurs finaux.",
  "Ils ne contiennent pas de routes techniques.",
  "",
  "Pour ajouter des photos dans les parcours utilisateur :",
  "deposer les captures dans photos-parcours/<role>/<parcours>/ puis relancer le generateur.",
].join("\n");

fs.writeFileSync(path.join(outputDir, "index.txt"), index, "utf8");

console.log(`${guides.length} guides PDF generes dans ${outputDir}`);
