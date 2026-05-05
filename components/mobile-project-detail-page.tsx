'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ProjectStatus, type SiteStatus, type ReportValidationStatus } from '@prisma/client';
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { SignedImage } from '@/components/mobile/SignedImage';
import type {
  MobileProjectDetailPhoto,
  MobileProjectDetailReport,
  MobileProjectDetailResponse,
  MobileProjectDetailSite,
  MobileProjectDetailTeam,
} from '@/types/mobile-projects';

type MobileProjectDetailPageProps = Readonly<{
  projectId: string;
}>;

type ProjectDetailTab = 'summary' | 'sites' | 'teams' | 'photos' | 'reports';

const tabs: { id: ProjectDetailTab; label: string }[] = [
  { id: 'summary', label: 'Résumé' },
  { id: 'sites', label: 'Chantiers' },
  { id: 'teams', label: 'Équipes' },
  { id: 'photos', label: 'Photos' },
  { id: 'reports', label: 'Rapports' },
];

export function MobileProjectDetailPage({ projectId }: MobileProjectDetailPageProps) {
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>('summary');
  const detailQuery = useQuery({
    queryKey: ['mobile-project-detail', projectId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/projects/${encodeURIComponent(projectId)}`);

      if (!response.ok) {
        // Lancer une erreur avec le statut pour une gestion spécifique
        const error = new Error(`Mobile project detail request failed with status ${response.status}`);
        (error as any).status = response.status;
        throw error;
      }

      return (await response.json()) as MobileProjectDetailResponse;
    },
    staleTime: 30_000,
  });

  const detail = detailQuery.data;
  const firstSiteId = detail?.sites.find((site) => site.status === 'ACTIVE')?.id ?? detail?.sites.at(0)?.id ?? null;
  const galleryHref = firstSiteId ? `/mobile/gallery?siteId=${encodeURIComponent(firstSiteId)}` : '/mobile/gallery';

  if (detailQuery.isLoading) {
    return <ProjectDetailLoadingState />;
  }

  if (detailQuery.isError || !detail) {
    // Déterminer le message d'erreur spécifique selon le statut
    const error = detailQuery.error as any;
    let errorMessage = 'Impossible de charger ce projet.';
    let errorDescription = 'Vérifiez votre accès puis réessayez.';
    
    if (error?.status) {
      switch (error.status) {
        case 404:
          errorMessage = 'Ce projet n\'existe pas ou a été supprimé.';
          errorDescription = 'Le projet que vous cherchez n\'est pas disponible ou a été supprimé.';
          break;
        case 403:
          errorMessage = 'Vous n\'avez pas accès à ce projet.';
          errorDescription = 'Contactez votre administrateur pour obtenir les accès nécessaires.';
          break;
        default:
          errorMessage = 'Erreur lors du chargement du projet.';
          errorDescription = `Une erreur est survenue (code: ${error.status}). Veuillez réessayer.`;
      }
    }

    return (
      <div className="space-y-5 pb-20">
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="text-sm font-bold text-red-700 mb-2">{errorMessage}</h2>
          <p className="text-xs text-red-600">{errorDescription}</p>
        </section>
        <Link
          className="flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700 shadow-panel"
          href="/mobile/projects"
        >
          Retour aux projets
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${projectStatusTone(detail.project.status)}`}>
                {humanizeProjectStatus(detail.project.status)}
              </span>
              {detail.project.hasAlert ? (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                  Alerte
                </span>
              ) : null}
            </div>
            <h1 className="mt-3 text-2xl font-black leading-7 text-slate-950">{detail.project.name}</h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              {detail.project.city} - {detail.project.address}
            </p>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {formatDate(detail.project.startDate)} - {detail.project.endDate ? formatDate(detail.project.endDate) : 'Fin ouverte'}
            </p>
            <p className="mt-1 text-xs font-bold text-slate-500">
              Chef de projet : {detail.project.projectManagerName}
            </p>
          </div>
          <Link
            className="flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-sm font-black text-white"
            href={`/mobile/projects/${encodeURIComponent(projectId)}/edit`}
          >
            Modifier
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <KpiTile label="Sites actifs" value={detail.kpis.activeSites} />
        <KpiTile label="Ressources" value={detail.kpis.resources} />
        <KpiTile label="Photos" value={detail.kpis.photos} />
        <KpiTile label="Rapports" value={detail.kpis.reports} />
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link
          className="flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-panel"
          href={`/mobile/sites/new?projectId=${encodeURIComponent(projectId)}`}
        >
          Nouveau chantier
        </Link>
        <Link
          className="flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-panel"
          href={`/mobile/teams/new?projectId=${encodeURIComponent(projectId)}`}
        >
          Nouvelle équipe
        </Link>
      </section>

      <section className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 shadow-panel [-webkit-overflow-scrolling:touch]">
        {tabs.map((tab) => (
          <button
            className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-black transition ${
              activeTab === tab.id ? 'bg-slate-950 text-white' : 'text-slate-600'
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === 'summary' ? <SummaryTab detail={detail} /> : null}
      {activeTab === 'sites' ? <SitesTab sites={detail.sites} /> : null}
      {activeTab === 'teams' ? <TeamsTab teams={detail.teams} /> : null}
      {activeTab === 'photos' ? <PhotosTab galleryHref={galleryHref} photos={detail.photos} /> : null}
      {activeTab === 'reports' ? <ReportsTab projectId={projectId} reports={detail.reports} /> : null}
    </div>
  );
}

function SummaryTab({ detail }: Readonly<{ detail: MobileProjectDetailResponse }>) {
  return (
    <section className="space-y-3">
      <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <h2 className="text-base font-black text-slate-950">Résumé</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{detail.project.description}</p>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Progression</span>
            <span>{detail.project.progressPercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${detail.project.progressPercent}%` }}
            />
          </div>
        </div>
      </article>
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="Chantiers" value={detail.project.sitesCount} />
        <MiniStat label="Équipes" value={detail.project.teamsCount} />
        <MiniStat label="Photos" value={detail.project.photosCount} />
        <MiniStat label="Rapports" value={detail.project.reportsCount} />
      </div>
    </section>
  );
}

function SitesTab({ sites }: Readonly<{ sites: MobileProjectDetailSite[] }>) {
  if (sites.length === 0) {
    return <EmptyPanel text="Aucun chantier rattaché à ce projet." />;
  }

  return (
    <section className="space-y-3">
      {sites.map((site) => (
        <Link
          className="block rounded-lg border border-slate-200 bg-white p-4 shadow-panel transition active:scale-[0.99]"
          href={`/mobile/sites/${encodeURIComponent(site.id)}`}
          key={site.id}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${siteStatusTone(site.status)}`}>
                {humanizeSiteStatus(site.status)}
              </span>
              <h3 className="mt-3 text-base font-black text-slate-950">{site.name}</h3>
              <p className="mt-1 text-sm font-semibold leading-5 text-slate-500">{site.address}</p>
            </div>
            <ChevronRightIcon className="mt-2 h-5 w-5 shrink-0 text-slate-400" />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2">
            <MiniMetric label="Équipes" value={site.teamsCount} />
            <MiniMetric label="Ress." value={site.resourcesCount} />
            <MiniMetric label="Photos" value={site.photosCount} />
            <MiniMetric label="Rapports" value={site.reportsCount} />
          </div>
        </Link>
      ))}
    </section>
  );
}

function TeamsTab({ teams }: Readonly<{ teams: MobileProjectDetailTeam[] }>) {
  if (teams.length === 0) {
    return <EmptyPanel text="Aucune équipe active sur ce projet." />;
  }

  return (
    <section className="space-y-3">
      {teams.map((team) => (
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={team.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-base font-black text-slate-950">{team.name}</h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">{team.siteName}</p>
              <p className="mt-1 text-xs font-bold text-slate-500">Chef : {team.teamLeadName}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">
              {team.membersCount}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {team.members.slice(0, 6).map((member) => (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600" key={member.id}>
                {member.name}
              </span>
            ))}
            {team.members.length > 6 ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                +{team.members.length - 6}
              </span>
            ) : null}
          </div>
        </article>
      ))}
    </section>
  );
}

function PhotosTab({
  photos,
  galleryHref,
}: Readonly<{
  photos: MobileProjectDetailPhoto[];
  galleryHref: string;
}>) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Aperçu photos</h2>
        <Link className="text-sm font-black text-primary" href={galleryHref}>
          Galerie
        </Link>
      </div>
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {photos.map((photo) => (
            <Link
              className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-panel"
              href={`/mobile/gallery?siteId=${encodeURIComponent(photo.siteId)}`}
              key={photo.id}
            >
              <div className="relative aspect-square bg-slate-100">
                <SignedImage
                  photoId={photo.id}
                  alt={photo.filename}
                  className="object-cover"
                  fill
                  sizes="50vw"
                />
              </div>
              <div className="p-2">
                <p className="truncate text-xs font-black text-slate-950">{photo.siteName}</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                  {photo.uploadedByName} - {formatDate(photo.createdAt)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyPanel text="Aucune photo récente sur ce projet." />
      )}
      <p className="text-xs font-semibold text-slate-500">Suppression disponible sur l&apos;application web</p>
    </section>
  );
}

function ReportsTab({
  reports,
  projectId,
}: Readonly<{
  reports: MobileProjectDetailReport[];
  projectId: string;
}>) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Derniers rapports</h2>
        <Link className="text-sm font-black text-primary" href={`/mobile/reports?projectId=${encodeURIComponent(projectId)}`}>
          Voir tout
        </Link>
      </div>
      {reports.length > 0 ? (
        reports.map((report) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={report.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-slate-950">{report.siteName}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {report.authorName} - {formatDate(report.submittedAt)}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-black text-slate-600">
                {humanizeReportStatus(report.validationStatus)}
              </span>
            </div>
            <p className="mt-3 line-clamp-4 text-sm font-semibold leading-6 text-slate-600">{report.content}</p>
          </article>
        ))
      ) : (
        <EmptyPanel text="Aucun rapport récent sur ce projet." />
      )}
    </section>
  );
}

function KpiTile({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <div className="text-3xl font-black text-slate-950">{value}</div>
      <div className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
    </article>
  );
}

function MiniStat({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-panel">
      <p className="text-xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-bold text-slate-500">{label}</p>
    </article>
  );
}

function MiniMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-center">
      <p className="text-base font-black text-slate-950">{value}</p>
      <p className="mt-1 truncate text-[10px] font-bold text-slate-500">{label}</p>
    </div>
  );
}

function EmptyPanel({ text }: Readonly<{ text: string }>) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">
      {text}
    </section>
  );
}

function ProjectDetailLoadingState() {
  return (
    <div className="space-y-5 pb-20">
      <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function humanizeProjectStatus(status: ProjectStatus) {
  switch (status) {
    case ProjectStatus.IN_PROGRESS:
      return 'En cours';
    case ProjectStatus.COMPLETED:
      return 'Terminé';
    case ProjectStatus.ON_HOLD:
      return 'En pause';
    case ProjectStatus.ARCHIVED:
      return 'Archivé';
    default:
      return status;
  }
}

function humanizeSiteStatus(status: SiteStatus) {
  if (status === 'ACTIVE') {
    return 'Actif';
  }

  if (status === 'ON_HOLD') {
    return 'En pause';
  }

  return 'Terminé';
}

function humanizeReportStatus(status: ReportValidationStatus) {
  if (status === 'VALIDATED_FOR_CLIENT') {
    return 'Validé';
  }

  return 'Soumis';
}

function projectStatusTone(status: ProjectStatus) {
  switch (status) {
    case ProjectStatus.IN_PROGRESS:
      return 'bg-emerald-100 text-emerald-800';
    case ProjectStatus.COMPLETED:
      return 'bg-slate-100 text-slate-700';
    case ProjectStatus.ON_HOLD:
      return 'bg-amber-100 text-amber-800';
    case ProjectStatus.ARCHIVED:
      return 'bg-sky-100 text-sky-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function siteStatusTone(status: SiteStatus) {
  if (status === 'ACTIVE') {
    return 'bg-emerald-100 text-emerald-800';
  }

  if (status === 'ON_HOLD') {
    return 'bg-amber-100 text-amber-800';
  }

  return 'bg-slate-100 text-slate-700';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function ChevronRightIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />,
  );
}
