'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SignedImage } from '@/components/mobile/SignedImage';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';

type SiteDetail = {
  id: string;
  name: string;
  address: string;
  status: 'ACTIVE' | 'INACTIVE' | 'COMPLETED';
  project: {
    id: string;
    name: string;
    projectManager: {
      firstName: string;
      lastName: string;
    };
  };
  teams: {
    id: string;
    name: string;
    members: {
      id: string;
      firstName: string;
      lastName: string;
      role: string;
    }[];
  }[];
  photos: {
    id: string;
    filename: string;
    url: string;
    takenAt: string;
    author: {
      firstName: string;
      lastName: string;
    };
  }[];
  clockInRecords: {
    id: string;
    arrivalAt: string;
    departureAt: string | null;
    user: {
      firstName: string;
      lastName: string;
    };
  }[];
  _count: {
    photos: number;
    clockInRecords: number;
  };
};

type MobileSiteDetailPageProps = Readonly<{
  siteId: string;
  user: WebSessionUser;
}>;

export function MobileSiteDetailPage({ siteId, user: _user }: MobileSiteDetailPageProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'team' | 'photos' | 'activity'>('info');

  const siteQuery = useQuery({
    queryKey: ['mobile-site-detail', siteId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/sites/${siteId}/detail`);

      if (!response.ok) {
        throw new Error(`Site detail request failed with status ${response.status}`);
      }

      return (await response.json()) as SiteDetail;
    },
    staleTime: 30_000,
  });

  const site = siteQuery.data;

  const statusColors = {
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    INACTIVE: 'bg-slate-100 text-slate-700',
    COMPLETED: 'bg-blue-100 text-blue-700',
  };

  const statusLabels = {
    ACTIVE: 'Actif',
    INACTIVE: 'Inactif',
    COMPLETED: 'Terminé',
  };

  if (siteQuery.isLoading) {
    return (
      <div className="space-y-5 pb-20">
        <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    );
  }

  if (siteQuery.isError || !site) {
    return (
      <div className="space-y-5 pb-20">
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          Impossible de charger les détails du chantier.
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      {/* Header */}
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-black text-slate-950 truncate">{site.name}</h1>
            <p className="text-sm text-slate-600 truncate">{site.project.name}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${statusColors[site.status]}`}>
            {statusLabels[site.status]}
          </span>
        </div>
        <p className="text-sm text-slate-700 line-clamp-2">{site.address}</p>
      </section>

      {/* Actions rapides */}
      <div className="grid grid-cols-3 gap-2">
        <button className="min-h-12 rounded-lg bg-primary text-white text-xs font-black shadow-panel transition active:scale-[0.98]">
          📷 Photo
        </button>
        <button className="min-h-12 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-black shadow-panel transition active:scale-[0.98]">
          ✏️ Modifier
        </button>
        <button className="min-h-12 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-black shadow-panel transition active:scale-[0.98]">
          📊 Rapport
        </button>
      </div>

      {/* Onglets */}
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1">
        <TabButton active={activeTab === 'info'} label="Infos" onClick={() => setActiveTab('info')} />
        <TabButton active={activeTab === 'team'} label="Équipe" onClick={() => setActiveTab('team')} />
        <TabButton active={activeTab === 'photos'} label="Photos" onClick={() => setActiveTab('photos')} />
        <TabButton active={activeTab === 'activity'} label="Activité" onClick={() => setActiveTab('activity')} />
      </div>

      {/* Contenu des onglets */}
      {activeTab === 'info' && <InfoTab site={site} />}
      {activeTab === 'team' && <TeamTab site={site} />}
      {activeTab === 'photos' && <PhotosTab site={site} />}
      {activeTab === 'activity' && <ActivityTab site={site} />}
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: Readonly<{ active: boolean; label: string; onClick: () => void }>) {
  return (
    <button
      className={`min-h-10 rounded-lg text-xs font-black transition active:scale-[0.98] ${
        active ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function InfoTab({ site }: Readonly<{ site: SiteDetail }>) {
  const totalMembers = site.teams.reduce((sum, team) => sum + team.members.length, 0);

  return (
    <section className="space-y-4">
      {/* Statistiques */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center shadow-panel">
          <div className="truncate text-lg font-black text-slate-950">{totalMembers}</div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            Équipe
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center shadow-panel">
          <div className="truncate text-lg font-black text-slate-950">{site._count.photos}</div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
            Photos
          </div>
        </div>
      </div>

      {/* Informations projet */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500 mb-3">
          Informations projet
        </h3>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-slate-600">Projet</span>
            <span className="text-sm font-semibold text-slate-900">{site.project.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-slate-600">Chef de projet</span>
            <span className="text-sm font-semibold text-slate-900">
              {site.project.projectManager.firstName} {site.project.projectManager.lastName}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-slate-600">Statut</span>
            <span className="text-sm font-semibold text-slate-900">{site.status}</span>
          </div>
        </div>
      </div>

      {/* Localisation */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500 mb-3">
          Localisation
        </h3>
        <p className="text-sm text-slate-700">{site.address}</p>
        <button className="mt-3 w-full min-h-10 rounded-lg bg-primary text-white text-xs font-black transition active:scale-[0.98]">
          📍 Voir sur la carte
        </button>
      </div>
    </section>
  );
}

function TeamTab({ site }: Readonly<{ site: SiteDetail }>) {
  return (
    <section className="space-y-4">
      {site.teams.map((team) => (
        <div key={team.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500 mb-3">
            {team.name}
          </h3>
          <div className="space-y-2">
            {team.members.map((member) => (
              <div key={member.id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-black text-slate-600">
                    {member.firstName[0]}{member.lastName[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {member.firstName} {member.lastName}
                    </p>
                    <p className="text-xs text-slate-500">{member.role}</p>
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function PhotosTab({ site }: Readonly<{ site: SiteDetail }>) {
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {site.photos.slice(0, 9).map((photo) => (
          <div key={photo.id} className="relative aspect-square overflow-hidden rounded-lg bg-slate-100">
            <SignedImage photoId={photo.id} alt={photo.filename} className="object-cover" fill sizes="33vw" />
            <div className="absolute bottom-0 left-0 right-0 bg-slate-950/70 px-1 py-0.5">
              <p className="text-[10px] text-white truncate">
                {new Date(photo.takenAt).toLocaleDateString('fr-FR', {
                  day: '2-digit',
                  month: '2-digit',
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
      
      {site.photos.length > 9 && (
        <button className="w-full min-h-12 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-black shadow-panel transition active:scale-[0.98]">
          Voir toutes les photos ({site.photos.length})
        </button>
      )}
    </section>
  );
}

function ActivityTab({ site }: Readonly<{ site: SiteDetail }>) {
  const recentActivity = site.clockInRecords.slice(0, 10);

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        {recentActivity.map((record) => (
          <div key={record.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-panel">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-black text-slate-600">
                  {record.user.firstName[0]}{record.user.lastName[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {record.user.firstName} {record.user.lastName}
                  </p>
                  <p className="text-xs text-slate-500">
                    Arrivée: {new Date(record.arrivalAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500">
                  {new Date(record.arrivalAt).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </p>
                {record.departureAt && (
                  <p className="text-xs text-emerald-600">
                    {new Date(record.departureAt).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
