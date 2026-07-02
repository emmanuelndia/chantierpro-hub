'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OfficeClockInLocation, PlanningWorkLocationType, type ClockInType, type Role } from '@prisma/client';
import { authFetch } from '@/lib/auth/client-session';
import { haversineDistanceKm } from '@/lib/haversine';
import {
  createOfflineClockInId,
  enqueueOfflineClockIn,
  enqueueOfflineComment,
  getMobileClockInPendingCount,
} from '@/lib/mobile-clock-in-offline';
import type {
  ClockInRecordItem,
  SessionStatus,
  TodayClockInView,
} from '@/types/clock-in';
import {
  getMobileOfflineCache,
  getPendingOfflineClockIns,
  setMobileOfflineCache,
  syncMobileOfflineQueue,
  type OfflineClockInItem,
} from '@/lib/mobile-offline-db';
import { buildLocalSessionStatus } from '@/lib/mobile-clock-in-session';
import { useGeolocation } from '@/lib/hooks/useGeolocation';
import { useMobileNetworkState } from '@/hooks/use-mobile-network-state';
import { getMobileOfflinePreparationState } from '@/lib/mobile-offline-prepare';
import type { TodaySiteItem } from '@/types/projects';
import type { NearbySiteItem } from '@/types/reports';
import type { OfficeLocationsResponse } from '@/types/office-locations';
import { MobileOfflineLink } from '@/components/mobile-offline-link';
import { useTodayOfficeAssignments } from '@/components/mobile-office-assignments-section';

type ClockInIntent = 'arrival' | 'departure' | 'pause-start' | 'pause-end';
type Step = 'clock-in' | 'comment' | 'confirmation';
type ClockContext = 'OFFICE' | 'SITE' | 'ZONE';

const TERRAIN_CLOCK_IN_ROLES: readonly Role[] = [
  'SUPERVISOR',
  'RESOURCE',
  'EXTERNAL_RESOURCE',
  'COORDINATOR',
  'GENERAL_SUPERVISOR',
  'BE_RESOURCE',
  'NEGOTIATION_RESOURCE',
  'NEGOTIATION_MANAGER',
  'FLEET_RESOURCE',
  'PROJECT_MANAGER',
];

const NEGOTIATION_CLOCK_IN_ROLES: readonly Role[] = ['NEGOTIATION_RESOURCE', 'NEGOTIATION_MANAGER'];
const OFFICE_ONLY_CLOCK_IN_ROLES: readonly Role[] = ['OFFICE_STAFF', 'HR', 'DIRECTION', 'ADMIN', 'AUDITOR'];
const todayKey = new Date().toISOString().slice(0, 10);

type GeoState =
  | { status: 'loading' }
  | { status: 'ready'; latitude: number; longitude: number; accuracy: number | null; source: 'LIVE' | 'CACHED'; capturedAt: string }
  | { status: 'unavailable'; message: string };

type SelectableSite = {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number;
  distanceKm: number | null;
  siteType: TodaySiteItem['siteType'] | null;
};

type Submission = {
  clientId: string;
  offline: boolean;
  record: ClockInRecordItem | null;
  type: ClockInType;
  siteId: string | null;
  freeMissionId?: string | null;
  siteName: string;
  timestampLocal: string;
  durationSeconds: number | null;
};

type TodaySitesResponse = {
  items: TodaySiteItem[];
};

type NearbySitesResponse = {
  sites: NearbySiteItem[];
};

type MobileNegotiationDay = {
    assignments: {
      id: string;
      project: { id: string; name: string; city: string };
      zoneId: string | null;
      zone: { id: string; name: string; city: string | null; region: string | null } | null;
      plannedZone: string | null;
      instruction: string | null;
      status: string;
    }[];
  openSession: {
    id: string;
    projectId: string;
    project: { id: string; name: string } | null;
    startTime: string;
    endTime: string | null;
    status: string;
    assignment: { id: string; plannedZone: string | null; instruction: string | null; zone?: { id: string; name: string } | null } | null;
    visitCount: number;
  } | null;
};

type PendingNegotiationSession = {
  clientId: string;
  startTime: string;
  siteName: string;
  negotiationAssignmentId: string | null;
};

const intentToType: Record<ClockInIntent, ClockInType> = {
  arrival: 'ARRIVAL',
  departure: 'DEPARTURE',
  'pause-start': 'PAUSE_START',
  'pause-end': 'PAUSE_END',
};

const typeLabels: Record<string, string> = {
  ARRIVAL: 'Entree',
  DEPARTURE: 'Sortie',
  PAUSE_START: 'Pause',
  PAUSE_END: 'Reprise',
  INTERMEDIATE: 'Intermediaire',
};

const contextLabels: Record<ClockContext, string> = {
  OFFICE: 'Bureau',
  SITE: 'Chantier',
  ZONE: 'Zone',
};

export function MobileClockInPage({ userRole }: Readonly<{ userRole: Role }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canUseTerrainClockIn = TERRAIN_CLOCK_IN_ROLES.includes(userRole);
  const isNegotiationClockInUser = NEGOTIATION_CLOCK_IN_ROLES.includes(userRole);
  const usesOfficeOnlyClockIn = OFFICE_ONLY_CLOCK_IN_ROLES.includes(userRole);
  const isFleetResource = userRole === 'FLEET_RESOURCE';
  const canUseProfessionalTravel = usesOfficeOnlyClockIn || userRole === 'PROJECT_MANAGER';
  const queryClient = useQueryClient();
  const requestedSiteId = searchParams.get('siteId');
  const requestedFreeMissionId = searchParams.get('freeMissionId');
  const requestedOffice = searchParams.get('office') === '1';
  const requestedOfficeAssignmentId = searchParams.get('assignmentId');
  const requestedIntent = parseIntent(searchParams.get('intent'));
  const networkState = useMobileNetworkState();
  const activeSessionContextInitializedRef = useRef(false);
  
  // Utiliser le nouveau hook de géolocalisation
  const geolocation = useGeolocation({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });

  // Convertir l'état du hook vers le format GeoState existant
  const geoState = useMemo<GeoState>(() => {
    if (geolocation.loading) {
      return { status: 'loading' };
    }

    if (geolocation.error || geolocation.latitude === null || geolocation.longitude === null) {
      return { status: 'unavailable', message: geolocation.error ?? 'GPS indisponible.' };
    }

    return {
      status: 'ready',
      latitude: geolocation.latitude,
      longitude: geolocation.longitude,
      accuracy: geolocation.accuracy,
      source: geolocation.source ?? 'LIVE',
      capturedAt: geolocation.capturedAt ?? new Date().toISOString(),
    };
  }, [geolocation.accuracy, geolocation.capturedAt, geolocation.error, geolocation.latitude, geolocation.loading, geolocation.longitude, geolocation.source]);

  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(requestedSiteId);
  const [selectedFreeMissionId, setSelectedFreeMissionId] = useState<string | null>(requestedFreeMissionId);
  const [selectedNegotiationAssignmentId, setSelectedNegotiationAssignmentId] = useState<string | null>(null);
  const [selectedOffice, setSelectedOffice] = useState(requestedOffice || (!requestedSiteId && !requestedFreeMissionId));
  const [selectedOfficeClockInLocation, setSelectedOfficeClockInLocation] = useState<OfficeClockInLocation>(OfficeClockInLocation.OFFICE);
  const [selectedOfficeAssignmentId, setSelectedOfficeAssignmentId] = useState<string | null>(requestedOfficeAssignmentId);
  const [selectedOfficeLocationId, setSelectedOfficeLocationId] = useState<string | null>(null);
  const [selectedClockContext, setSelectedClockContext] = useState<ClockContext>(
    requestedFreeMissionId ? 'ZONE' : requestedSiteId ? 'SITE' : 'OFFICE',
  );
  const [selectedIntent, setSelectedIntent] = useState<ClockInIntent>(requestedIntent ?? 'arrival');
  const [nearbySearchRequested, setNearbySearchRequested] = useState(false);
  const [step, setStep] = useState<Step>('clock-in');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [comment, setComment] = useState('');
  const [zoneActualName, setZoneActualName] = useState('');
  const [zoneSpecificPlace, setZoneSpecificPlace] = useState('');
  const [zoneClockInComment, setZoneClockInComment] = useState('');
  const [outOfPlanningSiteTask, setOutOfPlanningSiteTask] = useState('');
  const [travelActualZone, setTravelActualZone] = useState('');
  const [travelSpecificPlace, setTravelSpecificPlace] = useState('');
  const [travelReason, setTravelReason] = useState('');
  const [travelComment, setTravelComment] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [offlineReadyToday, setOfflineReadyToday] = useState(true);

  useEffect(() => {
    void getMobileOfflinePreparationState().then((preparation) => {
      setOfflineReadyToday(preparation.status === 'ready');
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshPendingCount();

    async function sync() {
      await syncMobileOfflineQueue({ mode: 'auto' });
      await refreshPendingCount();
      await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-today'] });
      await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-history'] });
    }

    const handleOnline = () => {
      void sync();
    };

    if (navigator.onLine) {
      handleOnline();
    }

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [queryClient]);

  const todayQuery = useQuery({
    queryKey: ['mobile-clock-in-today'],
    queryFn: async () => {
      let response: Response;
      try {
        response = await authFetch('/api/users/me/clock-in');
      } catch {
        const cached = await getMobileOfflineCache<TodayClockInView>('clock-in-today');
        if (cached) {
          return cached.payload;
        }

        throw new Error('Clock-in status failed');
      }

      if (!response.ok) {
        const cached = await getMobileOfflineCache<TodayClockInView>('clock-in-today');
        if (cached) {
          return cached.payload;
        }

        throw new Error('Clock-in status failed');
      }

      const payload = (await response.json()) as TodayClockInView;
      await setMobileOfflineCache('clock-in-today', payload, 30 * 60 * 1000);
      return payload;
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const todaySitesQuery = useQuery({
    queryKey: ['mobile-sites-today'],
    queryFn: async () => {
      let response: Response;
      try {
        response = await authFetch('/api/users/me/sites/today');
      } catch {
        const cached = await getMobileOfflineCache<TodaySitesResponse>('sites-today');

        if (cached) {
          return cached.payload;
        }

        throw new Error('Today sites failed');
      }

      if (!response.ok) {
        const cached = await getMobileOfflineCache<TodaySitesResponse>('sites-today');

        if (cached) {
          return cached.payload;
        }

        throw new Error('Today sites failed');
      }

      const payload = (await response.json()) as TodaySitesResponse;
      await setMobileOfflineCache('sites-today', payload, 24 * 60 * 60 * 1000);
      return payload;
    },
    enabled: canUseTerrainClockIn,
    staleTime: 300_000,
  });

  const pendingClockInsQuery = useQuery({
    queryKey: ['mobile-clock-in-pending-items'],
    queryFn: getPendingOfflineClockIns,
    staleTime: 0,
  });

  const officeLocationsQuery = useQuery({
    queryKey: ['mobile-office-locations'],
    queryFn: async () => {
      let response: Response;
      try {
        response = await authFetch('/api/mobile/office-locations');
      } catch {
        const cached = await getMobileOfflineCache<OfficeLocationsResponse>('mobile-office-locations');
        if (cached) {
          return cached.payload;
        }

        throw new Error('Office locations failed');
      }

      if (!response.ok) {
        const cached = await getMobileOfflineCache<OfficeLocationsResponse>('mobile-office-locations');
        if (cached) {
          return cached.payload;
        }

        throw new Error(`Office locations failed with status ${response.status}`);
      }

      const payload = (await response.json()) as OfficeLocationsResponse;
      await setMobileOfflineCache('mobile-office-locations', payload, 7 * 24 * 60 * 60 * 1000);
      return payload;
    },
    staleTime: 300_000,
  });

  const negotiationDayCacheKey = `mobile-negotiation-day-${todayKey}`;
  const negotiationDayQuery = useQuery({
    queryKey: ['mobile-negotiation-clock-in-day', todayKey],
    queryFn: async () => {
      let response: Response;
      try {
        response = await authFetch(`/api/mobile/negotiation?date=${encodeURIComponent(todayKey)}`);
      } catch {
        const cached = await getMobileOfflineCache<MobileNegotiationDay>(negotiationDayCacheKey);
        if (cached) {
          return cached.payload;
        }

        throw new Error('Negotiation day failed');
      }

      if (!response.ok) {
        const cached = await getMobileOfflineCache<MobileNegotiationDay>(negotiationDayCacheKey);
        if (cached) {
          return cached.payload;
        }

        throw new Error('Negotiation day failed');
      }

      const payload = (await response.json()) as MobileNegotiationDay;
      await setMobileOfflineCache(negotiationDayCacheKey, payload, 24 * 60 * 60 * 1000);
      return payload;
    },
    enabled: isNegotiationClockInUser,
    refetchInterval: 30_000,
  });

  const todaySites = useMemo(() => todaySitesQuery.data?.items ?? [], [todaySitesQuery.data?.items]);
  const officeLocations = officeLocationsQuery.data?.items ?? [];
  const selectedOfficeLocation =
    officeLocations.find((office) => office.id === selectedOfficeLocationId) ?? officeLocations[0] ?? null;
  const { assignments: todayAssignments, officeAssignments } = useTodayOfficeAssignments(true);
  const negotiationAssignments = useMemo(
    () => negotiationDayQuery.data?.assignments ?? [],
    [negotiationDayQuery.data?.assignments],
  );
  const selectedNegotiationAssignment = useMemo(
    () =>
      selectedNegotiationAssignmentId
        ? negotiationAssignments.find((assignment) => assignment.id === selectedNegotiationAssignmentId) ?? null
        : negotiationAssignments.length === 1
          ? negotiationAssignments[0] ?? null
          : null,
    [negotiationAssignments, selectedNegotiationAssignmentId],
  );
  const openNegotiationSession = negotiationDayQuery.data?.openSession ?? null;
  const pendingNegotiationSession = useMemo(
    () => findPendingNegotiationSession(pendingClockInsQuery.data ?? [], selectedNegotiationAssignment?.id ?? null),
    [pendingClockInsQuery.data, selectedNegotiationAssignment?.id],
  );
  const freeMissionAssignments = useMemo(
    () =>
      todayAssignments.filter(
        (assignment) =>
          assignment.kind !== 'NEGOTIATION_ASSIGNMENT' &&
          (assignment.workLocationType === PlanningWorkLocationType.FREE_MISSION || Boolean(assignment.freeMissionId)),
      ),
    [todayAssignments],
  );
  const hasFreeMissionToday = freeMissionAssignments.length > 0;
  const hasRequestedClassicFreeMission =
    Boolean(requestedFreeMissionId) &&
    freeMissionAssignments.some(
      (assignment) => assignment.freeMissionId === requestedFreeMissionId || assignment.id === requestedFreeMissionId,
    );
  const selectedFreeMissionFromAssignments = useMemo(
    () =>
      selectedFreeMissionId
        ? freeMissionAssignments.find((assignment) => assignment.freeMissionId === selectedFreeMissionId || assignment.id === selectedFreeMissionId) ?? null
        : freeMissionAssignments.length === 1
          ? freeMissionAssignments[0] ?? null
          : null,
    [freeMissionAssignments, selectedFreeMissionId],
  );
  const shouldSelectFreeMissionFromTasks = false;
  const selectedFreeMission =
    selectedClockContext === 'ZONE' && Boolean(selectedFreeMissionFromAssignments)
      ? selectedFreeMissionFromAssignments
      : null;
  const selectedFreeMissionKey = selectedFreeMission?.freeMissionId ?? selectedFreeMission?.id ?? null;
  const hasClassicZoneAssignments =
    hasFreeMissionToday || hasRequestedClassicFreeMission || todayQuery.data?.activeSession?.contextType === 'FREE_MISSION';
  const useNegotiationZoneFlow =
    isNegotiationClockInUser &&
    !selectedFreeMission &&
    !hasClassicZoneAssignments &&
    (Boolean(selectedNegotiationAssignment) || Boolean(openNegotiationSession) || Boolean(pendingNegotiationSession) || negotiationAssignments.length > 0);
  const isNegotiationZoneSelected =
    selectedClockContext === 'ZONE' && useNegotiationZoneFlow;
  const hasUnselectedZone = selectedClockContext === 'ZONE' && freeMissionAssignments.length > 1 && !selectedFreeMission;
  const nearbyQuery = useQuery({
    queryKey: ['mobile-sites-nearby', geoState.status === 'ready' ? geoState.latitude : null, geoState.status === 'ready' ? geoState.longitude : null],
    queryFn: async () => {
      if (geoState.status !== 'ready') {
        return { sites: [] } satisfies NearbySitesResponse;
      }

      const response = await authFetch(
        `/api/sites/nearby?lat=${encodeURIComponent(geoState.latitude)}&lng=${encodeURIComponent(geoState.longitude)}`,
      );

      if (!response.ok) {
        throw new Error('Nearby sites failed');
      }

      return (await response.json()) as NearbySitesResponse;
    },
    enabled:
      nearbySearchRequested &&
      canUseTerrainClockIn &&
      geoState.status === 'ready' &&
      !requestedSiteId &&
      !requestedFreeMissionId &&
      selectedClockContext === 'SITE' &&
      !shouldSelectFreeMissionFromTasks,
    staleTime: 30_000,
  });

  const selectedOfficeAssignment = useMemo(
    () => officeAssignments.find((assignment) => assignment.id === selectedOfficeAssignmentId) ?? null,
    [officeAssignments, selectedOfficeAssignmentId],
  );
  const singleOfficeAssignment = officeAssignments.length === 1 ? officeAssignments[0] ?? null : null;
  const activeSession = todayQuery.data?.activeSession ?? null;
  const hasZoneOption = canUseTerrainClockIn || useNegotiationZoneFlow || hasClassicZoneAssignments;
  const quickSite = nearbyQuery.data?.sites[0] ?? null;

  useEffect(() => {
    if (requestedIntent) {
      setSelectedIntent(requestedIntent);
      return;
    }

    if (activeSession) {
      setSelectedIntent('departure');
    }
  }, [activeSession, requestedIntent]);

  useEffect(() => {
    if (!activeSession) {
      activeSessionContextInitializedRef.current = false;
      return;
    }

    if (activeSessionContextInitializedRef.current) {
      return;
    }

    activeSessionContextInitializedRef.current = true;

    if (!selectedSiteId && activeSession.siteId) {
      setSelectedSiteId(activeSession.siteId);
    }
    if (!selectedOffice && activeSession?.contextType === 'OFFICE') {
      setSelectedOffice(true);
    }
    if (activeSession?.contextType === 'OFFICE' && activeSession.officeClockInLocation) {
      setSelectedOfficeClockInLocation(activeSession.officeClockInLocation);
    }
    if (activeSession?.contextType === 'OFFICE') {
      setSelectedClockContext('OFFICE');
    } else if (activeSession?.contextType === 'FREE_MISSION') {
      setSelectedClockContext('ZONE');
    } else if (activeSession?.contextType === 'SITE') {
      setSelectedClockContext('SITE');
    }
  }, [activeSession, selectedOffice, selectedSiteId]);

  useEffect(() => {
    if (selectedClockContext === 'OFFICE') {
      setSelectedOffice(true);
      setSelectedSiteId(null);
      setNearbySearchRequested(false);
      return;
    }

    setSelectedOffice(false);
    if (selectedClockContext === 'ZONE') {
      setSelectedSiteId(null);
      setNearbySearchRequested(false);
    }
  }, [selectedClockContext]);

  useEffect(() => {
    if (!selectedOffice || selectedOfficeAssignmentId || officeAssignments.length !== 1) {
      return;
    }

    const [onlyOfficeAssignment] = officeAssignments;
    if (onlyOfficeAssignment) {
      setSelectedOfficeAssignmentId(onlyOfficeAssignment.id);
    }
  }, [officeAssignments, selectedOffice, selectedOfficeAssignmentId]);

  useEffect(() => {
    if (selectedOffice || shouldSelectFreeMissionFromTasks || selectedFreeMission || selectedSiteId) {
      return;
    }

    const openSessionSite = todaySites.find((site) => site.hasOpenSession);

    if (openSessionSite) {
      setSelectedSiteId(openSessionSite.id);
    }
  }, [selectedFreeMission, selectedOffice, selectedSiteId, shouldSelectFreeMissionFromTasks, todaySites]);

  const selectedSite = useMemo(() => {
    if (selectedClockContext !== 'SITE') {
      return null;
    }

    const siteFromToday = todaySites.find((site) => site.id === selectedSiteId);

    if (siteFromToday) {
      return fromTodaySite(siteFromToday, geoState);
    }

    if (
      selectedSiteId &&
      quickSite?.id === selectedSiteId &&
      !selectedOffice &&
      !shouldSelectFreeMissionFromTasks
    ) {
      return fromNearbySite(quickSite);
    }

    if (
      selectedSiteId &&
      activeSession?.contextType === 'SITE' &&
      activeSession.siteId === selectedSiteId
    ) {
      return {
        id: selectedSiteId,
        name: activeSession.siteName,
        address: 'Session ouverte',
        latitude: null,
        longitude: null,
        radiusKm: 0,
        distanceKm: null,
        siteType: null,
      } satisfies SelectableSite;
    }

    return null;
  }, [activeSession, geoState, quickSite, selectedClockContext, selectedOffice, selectedSiteId, shouldSelectFreeMissionFromTasks, todaySites]);

  const sessionStatusQuery = useQuery({
    queryKey: ['mobile-session-status', selectedSite?.id, selectedFreeMission?.freeMissionId, selectedOffice],
    queryFn: async () => {
      if (selectedOffice) {
        if (networkState === 'offline') {
          return selectedOfficeLocationId
            ? buildOfflineSessionStatus(
                {
                  contextType: 'OFFICE',
                  officeLocationId: selectedOfficeClockInLocation === OfficeClockInLocation.OFFICE ? selectedOfficeLocationId : null,
                  officeClockInLocation: selectedOfficeClockInLocation,
                },
                todayQuery.data?.items ?? [],
                pendingClockInsQuery.data ?? [],
              )
            : null;
        }

        const response = await authFetch('/api/office-clock-in/session-status');
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as SessionStatus;
      }

      if (selectedFreeMission?.freeMissionId) {
        if (networkState === 'offline') {
          return buildOfflineSessionStatus(
            { contextType: 'FREE_MISSION', freeMissionId: selectedFreeMission.freeMissionId },
            todayQuery.data?.items ?? [],
            pendingClockInsQuery.data ?? [],
          );
        }

        const response = await authFetch(`/api/free-missions/${selectedFreeMission.freeMissionId}/clock-in/session-status`);
        if (!response.ok) {
          return null;
        }
        return (await response.json()) as SessionStatus;
      }

      if (!selectedSite) {
        return null;
      }

      try {
        const response = await authFetch(`/api/sites/${selectedSite.id}/clock-in/session-status`);

        if (!response.ok) {
          return buildOfflineSessionStatus(
            { contextType: 'SITE', siteId: selectedSite.id },
            todayQuery.data?.items ?? [],
            pendingClockInsQuery.data ?? [],
          );
        }

        return (await response.json()) as SessionStatus;
      } catch {
        return buildOfflineSessionStatus(
          { contextType: 'SITE', siteId: selectedSite.id },
          todayQuery.data?.items ?? [],
          pendingClockInsQuery.data ?? [],
        );
      }
    },
    enabled: Boolean(selectedSite ?? selectedFreeMission ?? selectedOffice) && !isNegotiationZoneSelected,
    refetchInterval: 15_000,
    staleTime: 30_000,
  });

  const localSessionStatus = selectedSite
    ? buildOfflineSessionStatus(
        { contextType: 'SITE', siteId: selectedSite.id },
        todayQuery.data?.items ?? [],
        pendingClockInsQuery.data ?? [],
      )
    : selectedFreeMission?.freeMissionId
      ? buildOfflineSessionStatus(
          { contextType: 'FREE_MISSION', freeMissionId: selectedFreeMission.freeMissionId },
          todayQuery.data?.items ?? [],
          pendingClockInsQuery.data ?? [],
        )
      : selectedOfficeLocation
        ? buildOfflineSessionStatus(
            {
              contextType: 'OFFICE',
              officeLocationId: selectedOfficeClockInLocation === OfficeClockInLocation.OFFICE ? selectedOfficeLocation.id : null,
              officeClockInLocation: selectedOfficeClockInLocation,
            },
            todayQuery.data?.items ?? [],
            pendingClockInsQuery.data ?? [],
          )
        : null;
  const sessionStatus =
    networkState === 'offline' || (pendingClockInsQuery.data?.length ?? 0) > 0
      ? localSessionStatus ?? sessionStatusQuery.data
      : sessionStatusQuery.data;
  const selectedSiteSessionLoaded = sessionStatus !== undefined || sessionStatusQuery.isError;
  const selectedContextSessionLoaded = isNegotiationZoneSelected || selectedSiteSessionLoaded;
  const hasOpenSession = isNegotiationZoneSelected
    ? Boolean(openNegotiationSession ?? pendingNegotiationSession)
    : selectedSite || selectedFreeMission || selectedOffice
      ? Boolean(sessionStatus?.sessionOpen)
      : Boolean(activeSession);
  const openSessionDifferentSite =
    Boolean(
      selectedSite &&
        sessionStatus?.sessionOpen &&
        sessionStatus.openSessionSiteId &&
        sessionStatus.openSessionSiteId !== selectedSite.id,
    );
  const pauseActive = Boolean(sessionStatus?.pauseActive);
  const pauseSeconds = pauseActive ? elapsedSeconds(null, now, sessionStatus?.pauseDuration) : 0;
  const siteIntent = (selectedSite || selectedFreeMission || selectedOffice || isNegotiationZoneSelected) && !hasOpenSession ? 'arrival' : selectedIntent;
  const currentIntent = pauseActive && siteIntent === 'pause-start' ? 'pause-end' : siteIntent;
  const currentType = intentToType[currentIntent];
  const selectedSiteIsAssignedToday = Boolean(selectedSite && todaySites.some((site) => site.id === selectedSite.id));
  const isOutOfPlanningSiteArrival =
    selectedClockContext === 'SITE' &&
    Boolean(selectedSite) &&
    !selectedSiteIsAssignedToday &&
    selectedSite?.address !== 'Session ouverte' &&
    currentType === 'ARRIVAL' &&
    !hasOpenSession;
  const outOfPlanningSiteTaskReady = !isOutOfPlanningSiteArrival || outOfPlanningSiteTask.trim().length >= 3;
  const selectedDistance = selectedSite?.distanceKm ?? null;
  const selectedOfficeDistance =
    selectedOfficeLocation && geoState.status === 'ready'
      ? haversineDistanceKm(
          { latitude: geoState.latitude, longitude: geoState.longitude },
          { latitude: selectedOfficeLocation.latitude, longitude: selectedOfficeLocation.longitude },
        )
      : null;
  const isAfterOfficeStartTime = isAfterLateThreshold(now);
  const outsideRadius = currentType === 'ARRIVAL' && selectedDistance !== null && selectedSite ? selectedDistance > selectedSite.radiusKm : false;
  const remoteDeparture =
    currentType === 'DEPARTURE' &&
    hasOpenSession &&
    !openSessionDifferentSite &&
    selectedDistance !== null &&
    selectedSite !== null &&
    selectedDistance > selectedSite.radiusKm;
  const activeContextLabel = contextLabels[selectedClockContext];
  const isProfessionalTravel = selectedOffice && selectedOfficeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL;
  const displayContextLabel = isProfessionalTravel ? 'Deplacement' : activeContextLabel;
  const staleOpenSession = activeSession?.isStaleOpenSession ? activeSession : null;
  const selectedContextReady = Boolean(selectedSite ?? selectedFreeMission ?? selectedOffice) || (isNegotiationZoneSelected && Boolean(selectedNegotiationAssignment ?? openNegotiationSession ?? pendingNegotiationSession));
  const isZoneClockInContext = selectedFreeMission !== null || isNegotiationZoneSelected;
  const usesSimplifiedFleetZone = isFleetResource && Boolean(selectedFreeMission) && !isNegotiationZoneSelected;
  const zoneActualNameRequired = isZoneClockInContext && !usesSimplifiedFleetZone && currentType === 'ARRIVAL';
  const zoneActualNameReady = !zoneActualNameRequired || zoneActualName.trim().length > 0;
  const travelDetailsRequired = isProfessionalTravel && currentType === 'ARRIVAL';
  const travelDetailsReady = !travelDetailsRequired || (travelActualZone.trim().length > 0 && travelReason.trim().length > 0);

  useEffect(() => {
    if ((!selectedFreeMissionKey && !selectedNegotiationAssignment?.id) || selectedClockContext !== 'ZONE') {
      setZoneActualName('');
      setZoneSpecificPlace('');
      setZoneClockInComment('');
      return;
    }

    setZoneActualName('');
    setZoneSpecificPlace('');
    setZoneClockInComment('');
  }, [selectedClockContext, selectedFreeMissionKey, selectedNegotiationAssignment?.id]);

  useEffect(() => {
    if (!isProfessionalTravel || currentType !== 'ARRIVAL') {
      setTravelActualZone('');
      setTravelSpecificPlace('');
      setTravelReason('');
      setTravelComment('');
    }
  }, [currentType, isProfessionalTravel]);

  useEffect(() => {
    if (!requestedIntent && sessionStatus?.sessionOpen) {
      setSelectedIntent('departure');
    }
  }, [requestedIntent, sessionStatus?.sessionOpen]);

  useEffect(() => {
    if (openNegotiationSession || pendingNegotiationSession) {
      setSelectedClockContext('ZONE');
      setSelectedIntent('departure');
    }
  }, [openNegotiationSession, pendingNegotiationSession]);

  const clockInMutation = useMutation({
    mutationFn: submitClockIn,
    onSuccess: async (result) => {
      setSubmission(result);
      setErrorMessage(null);
      setComment('');
      setStep('comment');
      await refreshPendingCount();
      await refreshClockInQueries();
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Pointage impossible.');
    },
  });

  const closeStaleSessionMutation = useMutation({
    mutationFn: closeStaleOpenSession,
    onSuccess: async (result) => {
      setSubmission(result);
      setErrorMessage(null);
      setComment('');
      setStep('comment');
      await refreshClockInQueries();
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Fermeture de session impossible.');
    },
  });

  const commentMutation = useMutation({
    mutationFn: async () => {
      if (!submission || comment.trim() === '') {
        return;
      }

      if (submission.offline) {
        await enqueueOfflineComment({ clientId: submission.clientId, comment: comment.trim() });
        await refreshPendingCount();
        return;
      }

      if (!submission.record) {
        return;
      }

      const response = await authFetch(`/api/clock-in/${submission.record.id}/comment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim() }),
      });

      if (!response.ok) {
        throw new Error(await readApiMessage(response, 'Commentaire impossible.'));
      }
    },
    onSuccess: () => moveAfterComment(),
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'Commentaire impossible.'),
  });

  const canSubmit =
    selectedContextReady &&
    zoneActualNameReady &&
    travelDetailsReady &&
    outOfPlanningSiteTaskReady &&
    geoState.status === 'ready' &&
    !outsideRadius &&
    (isProfessionalTravel ? networkState !== 'offline' : networkState !== 'offline' || offlineReadyToday) &&
    !(staleOpenSession && currentType === 'ARRIVAL') &&
    !clockInMutation.isPending;

  useEffect(() => {
    if (!isOutOfPlanningSiteArrival) {
      setOutOfPlanningSiteTask('');
    }
  }, [isOutOfPlanningSiteArrival]);

  useEffect(() => {
    if (step !== 'confirmation') {
      return;
    }

    const timer = window.setTimeout(() => router.push('/mobile/home'), 4_000);
    return () => window.clearTimeout(timer);
  }, [router, step]);

  async function submitClockIn(intentOverride?: ClockInIntent): Promise<Submission> {
    if (!selectedContextReady || geoState.status !== 'ready') {
      throw new Error('Position ou mission indisponible.');
    }

    const actionIntent = intentOverride ?? currentIntent;
    const actionType = intentToType[actionIntent];
    const actionOutsideRadius =
      Boolean(selectedSite) &&
      actionType === 'ARRIVAL' &&
      selectedSite!.distanceKm !== null &&
      selectedSite!.distanceKm > selectedSite!.radiusKm;

    if (actionOutsideRadius) {
      throw new Error('Vous etes hors du rayon autorise.');
    }

    const timestampLocal = toLocalIsoWithOffset(new Date());
    const clientId = createOfflineClockInId();
    const payload = {
      siteId: selectedSite?.id ?? null,
      freeMissionId: selectedFreeMission?.freeMissionId ?? null,
      type: actionType,
      latitude: geoState.latitude,
      longitude: geoState.longitude,
      accuracy: geoState.accuracy,
      timestampLocal,
      gpsCapturedAt: geoState.capturedAt,
      gpsSource: geoState.source,
    };

    if (selectedOffice) {
      if (isProfessionalTravel && actionType === 'ARRIVAL' && (!travelActualZone.trim() || !travelReason.trim())) {
        throw new Error('Renseignez la ville et le motif du deplacement.');
      }

      if (!isProfessionalTravel && !selectedOfficeLocation) {
        throw new Error('Selectionnez un bureau actif avant de pointer.');
      }

      const officeSiteName = isProfessionalTravel ? 'Deplacement professionnel' : selectedOfficeLocation?.name ?? 'Bureau';
      const officePayload = {
        ...payload,
        officeClockInLocation: selectedOfficeClockInLocation,
        ...(isProfessionalTravel
          ? {
              travelActualZone,
              travelSpecificPlace,
              travelReason,
              travelComment,
            }
          : {
              officeLocationId: selectedOfficeLocation!.id,
              planningAssignmentId: selectedOfficeAssignmentId,
            }),
      };

      if (isProfessionalTravel && !navigator.onLine) {
        throw new Error('Le pointage deplacement professionnel demande une connexion reseau pour cette version.');
      }

      if (!navigator.onLine) {
        await enqueueOfflineClockIn({
          clientId,
          siteName: officeSiteName,
          ...payload,
          officeLocationId: selectedOfficeLocation!.id,
          officeClockInLocation: selectedOfficeClockInLocation,
          planningAssignmentId: selectedOfficeAssignmentId,
        });

        return {
          clientId,
          offline: true,
          record: null,
          type: actionType,
          siteId: null,
          freeMissionId: null,
          siteName: officeSiteName,
          timestampLocal,
          durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
        };
      }

      const response = await authFetch('/api/office-clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(officePayload),
      });

      if (!response.ok) {
        throw new Error(await readApiMessage(response, 'Pointage bureau refuse.'));
      }

      const data = (await response.json()) as { record: ClockInRecordItem };

      return {
        clientId,
        offline: false,
        record: data.record,
        type: actionType,
        siteId: null,
        freeMissionId: null,
        siteName: officeSiteName,
        timestampLocal: data.record.timestampLocal,
        durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
      };
    }

    if (isNegotiationZoneSelected) {
      if (actionType === 'DEPARTURE') {
        const sessionToClose = openNegotiationSession ?? pendingNegotiationSession;
        if (!sessionToClose) {
          throw new Error('Aucune session negociation ouverte.');
        }

        if (!navigator.onLine || 'clientId' in sessionToClose) {
          const offlineSiteName = getNegotiationSessionLabel(sessionToClose) ?? 'Zone negociation';
          await enqueueOfflineClockIn({
            clientId,
            siteName: offlineSiteName,
            ...payload,
            negotiationSessionId: 'id' in sessionToClose && !('clientId' in sessionToClose) ? sessionToClose.id : null,
            negotiationSessionClientId: 'clientId' in sessionToClose ? sessionToClose.clientId : null,
            comment,
          });

          return {
            clientId,
            offline: true,
            record: null,
            type: actionType,
            siteId: null,
            freeMissionId: null,
            siteName: offlineSiteName,
            timestampLocal,
            durationSeconds: elapsedSeconds(sessionToClose.startTime, Date.parse(timestampLocal), 0),
          };
        }

        const response = await authFetch(`/api/mobile/negotiation/session/${encodeURIComponent(openNegotiationSession!.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: geoState.latitude,
            longitude: geoState.longitude,
            accuracy: geoState.accuracy,
            comment,
          }),
        });

        if (!response.ok) {
          throw new Error(await readApiMessage(response, 'Sortie zone negociation refusee.'));
        }

        const data = (await response.json()) as { session: { endTime: string | null; startTime: string; assignment: { plannedZone: string | null; zone?: { name: string } | null } | null; project: { name: string } | null } };

        return {
          clientId,
          offline: false,
          record: null,
          type: actionType,
          siteId: null,
          freeMissionId: null,
          siteName: data.session.assignment?.zone?.name ?? data.session.assignment?.plannedZone ?? data.session.project?.name ?? 'Zone negociation',
          timestampLocal: data.session.endTime ?? timestampLocal,
          durationSeconds: elapsedSeconds(data.session.startTime, Date.parse(data.session.endTime ?? timestampLocal), 0),
        };
      }

      if (!selectedNegotiationAssignment) {
        throw new Error('Selectionnez une zone negociation avant de pointer.');
      }

      const negotiationZoneComment = buildZoneClockInComment({
        actualZone: zoneActualName,
        specificPlace: zoneSpecificPlace,
        comment: zoneClockInComment,
      });

      if (!navigator.onLine) {
        const offlineSiteName = selectedNegotiationAssignment.zone?.name ?? selectedNegotiationAssignment.plannedZone ?? selectedNegotiationAssignment.project.name ?? 'Zone negociation';
        await enqueueOfflineClockIn({
          clientId,
          siteName: offlineSiteName,
          ...payload,
          negotiationAssignmentId: selectedNegotiationAssignment.id,
          negotiationProjectId: selectedNegotiationAssignment.project.id,
          negotiationDate: todayKey,
          comment: negotiationZoneComment,
        });

        return {
          clientId,
          offline: true,
          record: null,
          type: actionType,
          siteId: null,
          freeMissionId: null,
          siteName: offlineSiteName,
          timestampLocal,
          durationSeconds: null,
        };
      }

      const response = await authFetch('/api/mobile/negotiation/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: todayKey,
          assignmentId: selectedNegotiationAssignment.id,
          projectId: selectedNegotiationAssignment.project.id,
          latitude: geoState.latitude,
          longitude: geoState.longitude,
          accuracy: geoState.accuracy,
          comment: negotiationZoneComment,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiMessage(response, 'Entree zone negociation refusee.'));
      }

      const data = (await response.json()) as { session: { startTime: string; assignment: { plannedZone: string | null; zone?: { name: string } | null } | null; project: { name: string } | null } };

      return {
        clientId,
        offline: false,
        record: null,
        type: actionType,
        siteId: null,
        freeMissionId: null,
        siteName: data.session.assignment?.zone?.name ?? data.session.assignment?.plannedZone ?? data.session.project?.name ?? 'Zone negociation',
        timestampLocal: data.session.startTime,
        durationSeconds: null,
      };
    }

    if (selectedFreeMission) {
      if (actionType === 'ARRIVAL' && !usesSimplifiedFleetZone && !zoneActualName.trim()) {
        throw new Error('Renseignez la zone reelle avant de pointer.');
      }

      const missionId = selectedFreeMission.freeMissionId ?? selectedFreeMission.id;
      const zoneComment =
        actionType === 'ARRIVAL'
          ? usesSimplifiedFleetZone
            ? buildZoneClockInComment({
                actualZone: getFleetZoneLabel(selectedFreeMission),
                specificPlace: '',
                comment: 'Pointage simplifie parc auto',
              })
            : buildZoneClockInComment({
                actualZone: zoneActualName,
                specificPlace: zoneSpecificPlace,
                comment: zoneClockInComment,
              })
          : null;
      if (!navigator.onLine) {
        await enqueueOfflineClockIn({
          clientId,
          siteName: selectedFreeMission.siteName,
          ...payload,
          freeMissionId: missionId,
          comment: zoneComment,
        });

        return {
          clientId,
          offline: true,
          record: null,
          type: actionType,
          siteId: null,
          freeMissionId: missionId,
          siteName: selectedFreeMission.siteName,
          timestampLocal,
          durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
        };
      }

      const response = await authFetch(`/api/free-missions/${missionId}/clock-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          comment: zoneComment,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiMessage(response, 'Pointage mission libre refuse.'));
      }

      const data = (await response.json()) as { record: ClockInRecordItem };

      return {
        clientId,
        offline: false,
        record: data.record,
        type: actionType,
        siteId: null,
        freeMissionId: missionId,
        siteName: selectedFreeMission.siteName,
        timestampLocal: data.record.timestampLocal,
        durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
      };
    }

    if (!selectedSite) {
      throw new Error('Chantier indisponible.');
    }

    const siteOutOfPlanningTask = isOutOfPlanningSiteArrival && actionType === 'ARRIVAL' ? outOfPlanningSiteTask.trim() : '';

    if (isOutOfPlanningSiteArrival && actionType === 'ARRIVAL' && siteOutOfPlanningTask.length < 3) {
      throw new Error('Renseignez les taches a effectuer pour ce pointage hors planning.');
    }

    if (siteOutOfPlanningTask && !navigator.onLine) {
      throw new Error('Le pointage chantier hors planning demande une connexion reseau.');
    }

    if (!navigator.onLine) {
      await enqueueOfflineClockIn({
        clientId,
        siteName: selectedSite.name,
        ...payload,
        siteId: selectedSite.id,
      });

      return {
        clientId,
        offline: true,
        record: null,
        type: actionType,
        siteId: selectedSite.id,
        siteName: selectedSite.name,
        timestampLocal,
        durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
      };
    }

    const response = await authFetch(`/api/sites/${selectedSite.id}/clock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(siteOutOfPlanningTask ? { ...payload, comment: siteOutOfPlanningTask } : payload),
    });

    if (!response.ok) {
      throw new Error(await readApiMessage(response, 'Pointage refuse.'));
    }

    const data = (await response.json()) as { record: ClockInRecordItem };

    return {
      clientId,
      offline: false,
      record: data.record,
      type: actionType,
      siteId: selectedSite.id,
      siteName: selectedSite.name,
      timestampLocal: data.record.timestampLocal,
      durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
    };
  }

  async function closeStaleOpenSession(): Promise<Submission> {
    if (!staleOpenSession || geoState.status !== 'ready') {
      throw new Error('Ancienne session ou position GPS indisponible.');
    }

    if (!navigator.onLine) {
      throw new Error('La fermeture de session ancienne demande une connexion reseau.');
    }

    const timestampLocal = toLocalIsoWithOffset(new Date());
    const payload = {
      type: 'DEPARTURE',
      latitude: geoState.latitude,
      longitude: geoState.longitude,
      accuracy: geoState.accuracy,
      timestampLocal,
      gpsCapturedAt: geoState.capturedAt,
      gpsSource: geoState.source,
      comment: 'Fermeture d une session ancienne depuis le mobile.',
    };
    const endpoint =
      staleOpenSession.contextType === 'OFFICE'
        ? '/api/office-clock-in'
        : staleOpenSession.contextType === 'FREE_MISSION' && staleOpenSession.freeMissionId
          ? `/api/free-missions/${staleOpenSession.freeMissionId}/clock-in`
          : staleOpenSession.siteId
            ? `/api/sites/${staleOpenSession.siteId}/clock-in`
            : null;

    if (!endpoint) {
      throw new Error('Contexte de session ancienne incomplet.');
    }

    const response = await authFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await readApiMessage(response, 'Fermeture de session refusee.'));
    }

    const data = (await response.json()) as { record: ClockInRecordItem };

    return {
      clientId: createOfflineClockInId(),
      offline: false,
      record: data.record,
      type: 'DEPARTURE',
      siteId: staleOpenSession.siteId,
      freeMissionId: staleOpenSession.freeMissionId,
      siteName: staleOpenSession.contextName,
      timestampLocal: data.record.timestampLocal,
      durationSeconds: staleOpenSession.durationSeconds,
    };
  }

  async function refreshPendingCount() {
    setPendingCount(await getMobileClockInPendingCount());
  }

  async function refreshClockInQueries() {
    await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-pending-items'] });
    await queryClient.refetchQueries({ queryKey: ['mobile-clock-in-pending-items'], type: 'active' });
    await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-today'] });
    await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-history'] });
    await queryClient.invalidateQueries({ queryKey: ['mobile-negotiation-clock-in-day'] });
    await queryClient.invalidateQueries({ queryKey: ['mobile-session-status'] });
    await queryClient.refetchQueries({ queryKey: ['mobile-session-status'], type: 'active' });
  }

  
  function moveAfterComment() {
    if (submission?.type === 'DEPARTURE') {
      if (submission.record && (submission.siteId || submission.freeMissionId)) {
        router.push(`/rapport-session?sessionId=${encodeURIComponent(submission.record.id)}`);
        return;
      }

      setStep('confirmation');
      return;
    }

    setStep('confirmation');
  }

  if (step === 'confirmation' && submission) {
    return <ConfirmationView submission={submission} />;
  }

  if (step === 'comment' && submission) {
    return (
      <PostClockInPanel
        busy={commentMutation.isPending}
        errorMessage={errorMessage}
        label="Ajouter un commentaire (optionnel)"
        onPrimary={() => commentMutation.mutate()}
        onSkip={moveAfterComment}
        primaryLabel="Envoyer"
        setValue={setComment}
        title="Commentaire"
        value={comment}
      />
    );
  }

  return (
    <div className="space-y-5">
      {networkState === 'offline' && !offlineReadyToday ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
          Donnees offline du jour manquantes. Reconnectez-vous pour preparer les actions terrain.
        </div>
      ) : null}
      {networkState === 'offline' && offlineReadyToday && geoState.status !== 'ready' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          Offline prêt, mais le GPS est indisponible. Activez la localisation pour pointer.
        </div>
      ) : null}
      {pendingCount > 0 ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
          Synchronisation en attente : {pendingCount}
        </div>
      ) : null}

      {staleOpenSession ? (
        <section className="space-y-4 rounded-2xl border-2 border-orange-200 bg-orange-50 p-4 shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Session encore ouverte</p>
              <h2 className="mt-2 text-xl font-black text-slate-950">{staleOpenSession.contextName}</h2>
              <p className="mt-1 text-sm font-semibold text-orange-900">
                Entree le {formatDate(staleOpenSession.arrivalAt)} a {formatTime(staleOpenSession.arrivalAt)}
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-orange-700">
              {formatClockContext(staleOpenSession.contextType)}
            </span>
          </div>
          <p className="rounded-xl bg-white p-3 text-sm font-semibold leading-6 text-slate-700">
            Vous devez fermer cette ancienne session avant de pointer une nouvelle entree.
          </p>
          <ActionButton
            busy={closeStaleSessionMutation.isPending}
            disabled={geoState.status !== 'ready' || closeStaleSessionMutation.isPending}
            label="FERMER CETTE SESSION"
            onClick={() => closeStaleSessionMutation.mutate()}
            tone="danger"
          />
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Pointage</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">{displayContextLabel}</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">{typeLabels[currentType]}</p>
          </div>
          {activeSession ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-700">
              Session en cours
            </span>
          ) : null}
        </div>
        {usesOfficeOnlyClockIn ? (
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
            <ContextButton
              active={selectedClockContext === 'OFFICE' && selectedOfficeClockInLocation === OfficeClockInLocation.OFFICE}
              icon={<BuildingIcon className="h-4 w-4" />}
              label="Bureau"
              onClick={() => {
                setSelectedClockContext('OFFICE');
                setSelectedOfficeClockInLocation(OfficeClockInLocation.OFFICE);
              }}
            />
            <ContextButton
              active={selectedClockContext === 'OFFICE' && selectedOfficeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL}
              icon={<NavigationIcon className="h-4 w-4" />}
              label="Deplacement"
              onClick={() => {
                setSelectedClockContext('OFFICE');
                setSelectedOfficeClockInLocation(OfficeClockInLocation.PROFESSIONAL_TRAVEL);
              }}
            />
          </div>
        ) : (
          <div className={`mt-4 grid gap-2 rounded-2xl bg-slate-100 p-1 ${canUseProfessionalTravel ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
            <ContextButton
              active={selectedClockContext === 'OFFICE' && selectedOfficeClockInLocation === OfficeClockInLocation.OFFICE}
              icon={<BuildingIcon className="h-4 w-4" />}
              label="Bureau"
              onClick={() => {
                setSelectedClockContext('OFFICE');
                setSelectedOfficeClockInLocation(OfficeClockInLocation.OFFICE);
              }}
            />
            <ContextButton
              active={selectedClockContext === 'SITE'}
              disabled={!canUseTerrainClockIn}
              icon={<MapPinIcon className="h-4 w-4" />}
              label="Chantier"
              onClick={() => setSelectedClockContext('SITE')}
            />
            <ContextButton
              active={selectedClockContext === 'ZONE'}
              disabled={!hasZoneOption}
              icon={<NavigationIcon className="h-4 w-4" />}
              label="Zone"
              onClick={() => setSelectedClockContext('ZONE')}
            />
            {canUseProfessionalTravel ? (
              <ContextButton
                active={selectedClockContext === 'OFFICE' && selectedOfficeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL}
                icon={<NavigationIcon className="h-4 w-4" />}
                label="Deplacement"
                onClick={() => {
                  setSelectedClockContext('OFFICE');
                  setSelectedOfficeClockInLocation(OfficeClockInLocation.PROFESSIONAL_TRAVEL);
                }}
              />
            ) : null}
          </div>
        )}
      </section>

      {selectedClockContext === 'ZONE' ? (
        <section className="space-y-3 rounded-2xl border border-orange-100 bg-orange-50 p-4 shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">
                {useNegotiationZoneFlow ? 'Zone negociation' : 'Zone'}
              </p>
              <h3 className="mt-2 text-lg font-black text-slate-950">
                {useNegotiationZoneFlow
                  ? pendingNegotiationSession?.siteName ?? openNegotiationSession?.assignment?.zone?.name ?? openNegotiationSession?.assignment?.plannedZone ?? selectedNegotiationAssignment?.zone?.name ?? selectedNegotiationAssignment?.plannedZone ?? 'Choisir une zone nego'
                  : selectedFreeMission ? selectedFreeMission.action : 'Choisir une zone'}
              </h3>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                {useNegotiationZoneFlow
                  ? pendingNegotiationSession ? 'Session offline en attente' : openNegotiationSession?.project?.name ?? selectedNegotiationAssignment?.project.name ?? 'Pointage zone pour la negociation'
                  : selectedFreeMission ? selectedFreeMission.projectName : 'Pointage GPS sans chantier fixe'}
              </p>
            </div>
            <NavigationIcon className="h-7 w-7 text-orange-700" />
          </div>
          {useNegotiationZoneFlow ? (
            <>
              {negotiationAssignments.length === 0 && !openNegotiationSession && !pendingNegotiationSession ? (
                <p className="rounded-xl bg-white p-3 text-sm font-semibold leading-6 text-slate-600">
                  Aucune zone negociation prevue aujourd&apos;hui. Le responsable doit planifier depuis Suivi negociation.
                </p>
              ) : negotiationAssignments.length > 1 && !openNegotiationSession && !pendingNegotiationSession ? (
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Zone nego a pointer</span>
                  <select
                    className="min-h-12 w-full rounded-xl border border-orange-100 bg-white px-3 text-sm font-bold text-slate-950 outline-none"
                    onChange={(event) => setSelectedNegotiationAssignmentId(event.target.value || null)}
                    value={selectedNegotiationAssignment?.id ?? ''}
                  >
                    <option value="">Selectionner une zone nego</option>
                    {negotiationAssignments.map((assignment) => (
                      <option key={assignment.id} value={assignment.id}>
                        {assignment.zone?.name ?? assignment.plannedZone ?? 'Zone libre'} - {assignment.project.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="rounded-xl bg-white p-3">
                <p className="text-sm font-black text-slate-950">Pointage zone negociation.</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  Ce pointage compte comme presence terrain. Les scopes se renseignent ensuite dans l&apos;ecran Negociation.
                </p>
                <button
                  className="mt-3 rounded-xl bg-orange-600 px-4 py-2 text-xs font-black text-white"
                  onClick={() => router.push('/mobile/negotiation')}
                  type="button"
                >
                  Ouvrir les scopes
                </button>
              </div>
              {selectedNegotiationAssignment?.instruction ? (
                <p className="rounded-xl bg-white p-3 text-sm font-semibold text-orange-900">{selectedNegotiationAssignment.instruction}</p>
              ) : null}
            </>
          ) : freeMissionAssignments.length === 0 ? (
            <p className="rounded-xl bg-white p-3 text-sm font-semibold leading-6 text-slate-600">
              Aucune zone prevue aujourd&apos;hui.
            </p>
          ) : freeMissionAssignments.length > 1 ? (
            isFleetResource ? (
              <div className="space-y-2">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Zone a pointer</p>
                <div className="grid gap-2">
                  {freeMissionAssignments.map((assignment) => {
                    const assignmentKey = assignment.freeMissionId ?? assignment.id;
                    const selected = selectedFreeMissionKey === assignmentKey;
                    return (
                      <button
                        className={`min-h-16 rounded-xl border px-4 py-3 text-left transition ${
                          selected ? 'border-orange-500 bg-white text-slate-950 shadow-sm' : 'border-orange-100 bg-white/80 text-slate-700'
                        }`}
                        key={assignment.id}
                        onClick={() => setSelectedFreeMissionId(assignmentKey)}
                        type="button"
                      >
                        <span className="block text-sm font-black">{assignment.action}</span>
                        <span className="mt-1 block text-xs font-semibold text-slate-500">{assignment.projectName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Zone a pointer</span>
                <select
                  className="min-h-12 w-full rounded-xl border border-orange-100 bg-white px-3 text-sm font-bold text-slate-950 outline-none"
                  onChange={(event) => setSelectedFreeMissionId(event.target.value || null)}
                  value={selectedFreeMission?.freeMissionId ?? selectedFreeMission?.id ?? ''}
                >
                  <option value="">Selectionner une zone</option>
                  {freeMissionAssignments.map((assignment) => (
                    <option key={assignment.id} value={assignment.freeMissionId ?? assignment.id}>
                      {assignment.action} - {assignment.projectName}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : null}
          <div className="rounded-xl bg-white p-3">
            <p className="text-sm font-black text-slate-950">Pointage GPS sans chantier fixe.</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
              Aucun chantier proche ne sera detecte automatiquement.
            </p>
          </div>
          {usesSimplifiedFleetZone && currentType === 'ARRIVAL' ? (
            <div className="rounded-xl bg-white p-3 text-sm font-semibold leading-6 text-orange-900">
              Pointage simplifie parc auto : aucune saisie texte n&apos;est demandee. La zone prevue et le GPS seront enregistres automatiquement.
            </div>
          ) : null}
          {isZoneClockInContext && !usesSimplifiedFleetZone && currentType === 'ARRIVAL' ? (
            <div className="space-y-3 rounded-xl bg-white p-3">
              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">
                  Zone reelle / commune
                </span>
                <input
                  className="min-h-12 w-full rounded-xl border border-orange-100 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-orange-400"
                  onChange={(event) => setZoneActualName(event.target.value)}
                  placeholder="Ex: Yopougon, Bingerville..."
                  value={zoneActualName}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                  Lieu ou quartier precis
                </span>
                <input
                  className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 outline-none focus:border-orange-300"
                  onChange={(event) => setZoneSpecificPlace(event.target.value)}
                  placeholder="Facultatif"
                  value={zoneSpecificPlace}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Commentaire</span>
                <textarea
                  className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-orange-300"
                  onChange={(event) => setZoneClockInComment(event.target.value)}
                  placeholder="Facultatif"
                  value={zoneClockInComment}
                />
              </label>
              {!zoneActualNameReady ? (
                <p className="text-xs font-bold text-red-700">Renseignez la zone reelle avant de pointer.</p>
              ) : null}
            </div>
          ) : null}
          {hasUnselectedZone ? (
            <p className="rounded-xl border border-orange-200 bg-white p-3 text-xs font-bold text-orange-800">
              Selectionnez la zone a pointer avant d&apos;enregistrer l&apos;entree.
            </p>
          ) : null}
          {selectedFreeMission?.targetQuantity !== null && selectedFreeMission?.targetQuantity !== undefined && selectedFreeMission.targetQuantity > 0 ? (
            <p className="text-sm font-black text-orange-900">
              Objectif {formatQuantity(selectedFreeMission.targetQuantity)} {selectedFreeMission.targetUnit ?? ''}
            </p>
          ) : selectedFreeMission?.targetProgress !== null && selectedFreeMission?.targetProgress !== undefined ? (
            <p className="text-sm font-black text-orange-900">Objectif {selectedFreeMission.targetProgress}%</p>
          ) : null}
          {selectedFreeMission?.plannedDurationMinutes ? (
            <p className="text-xs font-bold text-orange-900">Duree prevue : {selectedFreeMission.plannedDurationMinutes} min</p>
          ) : null}
          {selectedFreeMission?.objectiveText ? (
            <p className="text-sm font-semibold text-orange-900">{selectedFreeMission.objectiveText}</p>
          ) : null}
        </section>
      ) : null}

      {false ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Pointage quotidien</p>
            <h3 className="mt-2 text-lg font-black text-slate-950">Pointage bureau</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              Si vous travaillez au bureau aujourd&apos;hui, pointez ici sans tâche planning.
            </p>
          </div>
          <button
            className={`min-h-12 w-full rounded-lg px-4 text-sm font-black ${
              selectedOffice ? 'bg-slate-950 text-white' : 'border border-slate-300 bg-white text-slate-700'
            }`}
            onClick={() => {
              setSelectedOffice(true);
              setSelectedOfficeLocationId(selectedOfficeLocation?.id ?? null);
              setSelectedSiteId(null);
              setNearbySearchRequested(false);
            }}
            type="button"
          >
            {selectedOffice ? 'Bureau sélectionné' : 'Pointer au bureau'}
          </button>
        </section>
      ) : null}

      {selectedClockContext === 'OFFICE' ? (
        <section className="space-y-4 rounded-2xl border border-sky-100 bg-white p-4 shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Presence bureau</p>
              <h3 className="mt-2 text-lg font-black text-slate-950">
                {isProfessionalTravel ? 'Deplacement professionnel' : 'Pointage bureau'}
              </h3>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                {isProfessionalTravel
                  ? 'Presence professionnelle hors bureau, sans chantier ni projet.'
                  : 'Presence quotidienne independante du planning.'}
              </p>
            </div>
            <span className="rounded-full bg-sky-600 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white">
              {isProfessionalTravel ? 'Deplacement' : 'Bureau'}
            </span>
          </div>
          {isAfterOfficeStartTime && currentType === 'ARRIVAL' ? (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-900">
              Arrivee apres 08:30 : ce pointage sera signale en retard.
            </div>
          ) : null}
          {isProfessionalTravel && currentType === 'ARRIVAL' ? (
            <div className="space-y-3 rounded-lg border border-sky-100 bg-sky-50 p-3">
              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Ville / zone reelle</span>
                <input
                  className="min-h-12 w-full rounded-lg border border-sky-100 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-sky-400"
                  onChange={(event) => setTravelActualZone(event.target.value)}
                  placeholder="Ex: Bouake, San Pedro..."
                  value={travelActualZone}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Lieu precis</span>
                <input
                  className="min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-300"
                  onChange={(event) => setTravelSpecificPlace(event.target.value)}
                  placeholder="Facultatif"
                  value={travelSpecificPlace}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Motif du deplacement</span>
                <input
                  className="min-h-12 w-full rounded-lg border border-sky-100 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-sky-400"
                  onChange={(event) => setTravelReason(event.target.value)}
                  placeholder="Ex: reunion, mission administrative..."
                  value={travelReason}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Commentaire</span>
                <textarea
                  className="min-h-20 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-sky-300"
                  onChange={(event) => setTravelComment(event.target.value)}
                  placeholder="Facultatif"
                  value={travelComment}
                />
              </label>
              {!travelDetailsReady ? (
                <p className="text-xs font-bold text-red-700">Renseignez la ville et le motif du deplacement.</p>
              ) : null}
            </div>
          ) : null}
          {!isProfessionalTravel && officeAssignments.length > 0 ? (
            <div className="space-y-3 rounded-lg border border-sky-100 bg-sky-50 p-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">Taches bureau prevues</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">
                  Le pointage bureau prouve la presence. La tache selectionnee indique le travail prevu.
                </p>
              </div>
              {singleOfficeAssignment ? (
                <div className="rounded-lg bg-white p-3">
                  <p className="text-sm font-black text-slate-950">{singleOfficeAssignment.action}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{singleOfficeAssignment.projectName}</p>
                </div>
              ) : (
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Tache liee</span>
                  <select
                    className="min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none"
                    onChange={(event) => setSelectedOfficeAssignmentId(event.target.value || null)}
                    value={selectedOfficeAssignment?.id ?? ''}
                  >
                    <option value="">Pointage bureau sans tache precise</option>
                    {officeAssignments.map((assignment) => (
                      <option key={assignment.id} value={assignment.id}>
                        {assignment.action}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : null}
          {!isProfessionalTravel ? (
            <>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Bureau</label>
                <select
                  className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none"
                  onChange={(event) => setSelectedOfficeLocationId(event.target.value)}
                  value={selectedOfficeLocation?.id ?? ''}
                >
                  {officeLocations.length === 0 ? <option value="">Aucun bureau actif</option> : null}
                  {officeLocations.map((office) => (
                    <option key={office.id} value={office.id}>
                      {office.name} - {office.address}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Distance</p>
                  <p className="mt-1 text-sm font-black text-slate-950">
                    {selectedOfficeDistance === null ? 'GPS requis' : `${selectedOfficeDistance.toFixed(2)} km`}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Rayon bureau</p>
                  <p className="mt-1 text-sm font-black text-slate-950">{selectedOfficeLocation?.radiusKm ?? '-'} km</p>
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Position</p>
                <p className="mt-1 text-sm font-black text-slate-950">GPS actif</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">Rayon</p>
                <p className="mt-1 text-sm font-black text-slate-950">Non applique</p>
              </div>
            </div>
          )}
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">
            {isProfessionalTravel
              ? 'La position GPS est enregistree comme preuve du deplacement. Aucun bureau, chantier ou projet ne sera impose.'
              : 'La position GPS est enregistree comme preuve du pointage. Aucun chantier proche ne sera selectionne.'}
          </p>
        </section>
      ) : null}

      {selectedClockContext === 'SITE' && selectedSite ? (
        <section className="space-y-3 rounded-lg border-2 border-primary/30 bg-white p-4 shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Mode chantier</p>
              <h3 className="mt-2 text-lg font-black text-slate-950">{selectedSite.name}</h3>
              <p className="mt-1 text-sm font-semibold text-slate-600">{selectedSite.address}</p>
            </div>
            <span className="rounded-full bg-primary px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-white">
              Zone GPS
            </span>
          </div>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">
            {selectedSite.address === 'Session ouverte'
              ? 'Une session est encore ouverte sur ce chantier. Vous pouvez pointer la sortie meme si vous etes hors zone.'
              : 'Ce pointage sera rattache a ce chantier. La distance et le rayon autorise sont verifies avec votre position GPS.'}
          </p>
        </section>
      ) : null}

      {isOutOfPlanningSiteArrival ? (
        <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Hors planning</p>
              <h3 className="mt-1 text-base font-black text-slate-950">Pointage chantier a valider</h3>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-amber-800">
              PM notifie
            </span>
          </div>
          <p className="text-sm font-semibold leading-6 text-amber-900">
            Ce chantier est proche, mais il n&apos;est pas dans votre planning du jour. Le pointage hors planning exige une presence a moins de 100 m du chantier. Decrivez les taches prevues avant de pointer.
          </p>
          <label className="block space-y-2">
            <span className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Taches a effectuer</span>
            <textarea
              className="min-h-24 w-full rounded-lg border border-amber-200 bg-white px-3 py-3 text-sm font-bold text-slate-950 outline-none focus:border-amber-400"
              onChange={(event) => setOutOfPlanningSiteTask(event.target.value)}
              placeholder="Ex: verification installation, assistance equipe, livraison materiel..."
              value={outOfPlanningSiteTask}
            />
          </label>
          {!outOfPlanningSiteTaskReady ? (
            <p className="text-xs font-bold text-red-700">Renseignez les taches a effectuer avant de pointer.</p>
          ) : null}
        </section>
      ) : null}

      {geoState.status === 'unavailable' || outsideRadius ? (
        <GpsPanel
          geoState={geoState}
          onRetry={geolocation.refresh}
          outsideRadius={outsideRadius}
          selectedSite={selectedSite}
          canRetry={geolocation.canRetry}
        />
      ) : (
        <GpsStatusBar geoState={geoState} selectedSite={selectedSite} />
      )}

      {selectedClockContext === 'SITE' && canUseTerrainClockIn && !shouldSelectFreeMissionFromTasks ? (
        <ManualSiteList
          geoState={geoState}
          loading={todaySitesQuery.isLoading}
          nearbySearchRequested={nearbySearchRequested}
          nearbyQueryFetching={nearbyQuery.isFetching}
          onSelect={(siteId) => {
            setSelectedSiteId(siteId);
            setNearbySearchRequested(false);
          }}
          onSearchNearby={() => {
            setNearbySearchRequested(true);
            if (geoState.status !== 'ready') {
              geolocation.refresh();
              return;
            }
            void nearbyQuery.refetch();
          }}
          selectedSiteId={selectedSite?.id ?? null}
          sites={todaySites}
        />
      ) : null}

      {selectedClockContext === 'SITE' && nearbySearchRequested && !nearbyQuery.isFetching && geoState.status === 'ready' && !quickSite ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
          Aucun chantier proche trouve.
        </p>
      ) : null}

      {false ? (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Aide GPS</p>
            <h3 className="mt-2 text-lg font-black text-slate-950">Chantier proche</h3>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
              Lancez la recherche uniquement si vous voulez pointer sur un chantier proche non selectionne.
            </p>
          </div>
          <button
            className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-sm font-black text-slate-800"
            onClick={() => {
              setNearbySearchRequested(true);
              if (geoState.status !== 'ready') {
                geolocation.refresh();
                return;
              }
              void nearbyQuery.refetch();
            }}
            type="button"
          >
            Rechercher un chantier proche
          </button>
          {nearbySearchRequested && geoState.status !== 'ready' ? (
            <p className="text-sm font-semibold text-slate-500">GPS requis pour rechercher un chantier proche.</p>
          ) : null}
          {nearbySearchRequested && nearbyQuery.isFetching ? (
            <p className="text-sm font-semibold text-slate-500">Recherche du chantier le plus proche...</p>
          ) : null}
          {nearbySearchRequested && !nearbyQuery.isFetching && geoState.status === 'ready' && !quickSite ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
              Aucun chantier proche trouve. Vous pouvez choisir un chantier assigne ou pointer au bureau.
            </p>
          ) : null}
        </section>
      ) : null}

      {selectedClockContext === 'SITE' && !shouldSelectFreeMissionFromTasks && nearbySearchRequested && quickSite ? (
        <NearbySuggestionCard
          onSelect={() => {
            setSelectedSiteId(quickSite.id);
          }}
          isAssignedToday={todaySites.some((site) => site.id === quickSite.id)}
          site={quickSite}
        />
      ) : null}

      {!staleOpenSession && selectedContextReady ? (
        <section className="space-y-3">
          {!selectedContextSessionLoaded ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-sm font-bold text-slate-600">
              Verification de la session...
            </div>
          ) : openSessionDifferentSite ? (
            <div className="space-y-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm font-bold text-orange-900">
                Session ouverte sur {sessionStatus?.openSessionSiteName ?? 'un autre chantier'} depuis{' '}
                {sessionStatus?.arrivalTime ? formatTime(sessionStatus.arrivalTime) : '--:--'}.
              </p>
              <p className="text-xs font-semibold text-orange-800">
                Pointez votre sortie avant de changer de chantier.
              </p>
              <ActionButton
                busy={false}
                disabled={!sessionStatus?.openSessionSiteId}
                label="Pointer ma sortie sur le chantier ouvert"
                onClick={() => {
                  if (sessionStatus?.openSessionSiteId) {
                    setSelectedSiteId(sessionStatus.openSessionSiteId);
                    setSelectedIntent('departure');
                  }
                }}
                tone="danger"
              />
            </div>
          ) : hasOpenSession ? (
            <>
              {remoteDeparture ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                  Vous etes hors du chantier. La sortie sera enregistree avec votre position actuelle.
                </div>
              ) : null}
              <ActionButton
                busy={clockInMutation.isPending && currentType === 'DEPARTURE'}
                disabled={geoState.status !== 'ready' || clockInMutation.isPending}
                label={
                  isNegotiationZoneSelected
                    ? 'POINTER SORTIE ZONE NEGO'
                    : isProfessionalTravel
                      ? 'POINTER SORTIE DEPLACEMENT'
                      : selectedOffice
                        ? 'POINTER SORTIE BUREAU'
                        : remoteDeparture
                          ? 'FERMER SESSION A DISTANCE'
                          : 'POINTER SORTIE'
                }
                onClick={() => {
                  setSelectedIntent('departure');
                  clockInMutation.mutate('departure');
                }}
                tone="danger"
              />
              <ActionButton
                busy={clockInMutation.isPending && (currentType === 'PAUSE_START' || currentType === 'PAUSE_END')}
                disabled={geoState.status !== 'ready' || clockInMutation.isPending}
                label={
                  isProfessionalTravel
                    ? pauseActive
                      ? 'TERMINER PAUSE DEPLACEMENT'
                      : 'DEMARRER PAUSE DEPLACEMENT'
                    : pauseActive
                      ? 'TERMINER PAUSE'
                      : 'DEMARRER PAUSE'
                }
                onClick={() => {
                  const intent = pauseActive ? 'pause-end' : 'pause-start';
                  setSelectedIntent(intent);
                  clockInMutation.mutate(intent);
                }}
                tone={pauseActive ? 'success' : 'warning'}
              />
              {pauseActive ? (
                <p className="text-center text-sm font-bold text-orange-800">
                  Pause depuis {formatShortDuration(pauseSeconds)}
                </p>
              ) : null}
            </>
          ) : (
            <ActionButton
              busy={clockInMutation.isPending}
              disabled={!canSubmit}
              label={
                isNegotiationZoneSelected
                  ? 'POINTER ENTREE ZONE NEGO'
                  : selectedFreeMission
                    ? 'POINTER ENTREE ZONE'
                    : isProfessionalTravel
                      ? 'POINTER ENTREE DEPLACEMENT'
                      : selectedOffice
                        ? 'POINTER ENTREE BUREAU'
                        : 'POINTER ENTREE'
              }
              onClick={() => {
                setSelectedIntent('arrival');
                clockInMutation.mutate('arrival');
              }}
              tone="primary"
            />
          )}
        </section>
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <MobileOfflineLink className="block text-center text-sm font-bold text-slate-500" href="/mobile/home">
        Retour accueil
      </MobileOfflineLink>
    </div>
  );
}

function toLocalIsoWithOffset(value: Date) {
  const offsetMinutes = -value.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
  const offsetRemainderMinutes = String(absoluteOffset % 60).padStart(2, '0');
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  const second = String(value.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offsetHours}:${offsetRemainderMinutes}`;
}

function ContextButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: Readonly<{
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}>) {
  return (
    <button
      className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-2 text-xs font-black transition ${
        active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600'
      } disabled:cursor-not-allowed disabled:opacity-40`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function GpsStatusBar({
  geoState,
  selectedSite,
}: Readonly<{
  geoState: GeoState;
  selectedSite: SelectableSite | null;
}>) {
  if (geoState.status === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-600">
        <Spinner className="h-4 w-4" />
        GPS en cours...
      </div>
    );
  }

  if (geoState.status === 'unavailable') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-800">
        <MapPinIcon className="h-4 w-4" />
        GPS indisponible
      </div>
    );
  }

  const precision = geoState.accuracy === null ? 'precision inconnue' : `precision ${Math.round(geoState.accuracy)} m`;
  const weak = geoState.accuracy !== null && geoState.accuracy > 100;
  const distance = selectedSite?.distanceKm ?? null;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm font-bold ${
        weak ? 'border-yellow-200 bg-yellow-50 text-yellow-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
    >
      <span>{weak ? 'GPS faible' : 'GPS pret'} · {precision}</span>
      {selectedSite && distance !== null ? <span>{distance.toFixed(2)} km du chantier</span> : null}
    </div>
  );
}

function GpsPanel({
  geoState,
  onRetry,
  outsideRadius,
  selectedSite,
  canRetry,
}: Readonly<{
  geoState: GeoState;
  onRetry: () => void;
  outsideRadius: boolean;
  selectedSite: SelectableSite | null;
  canRetry?: boolean;
}>) {
  if (geoState.status === 'loading') {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-panel">
        <Spinner className="mx-auto h-12 w-12 text-primary" />
        <p className="mt-4 text-lg font-black text-slate-950">Localisation en cours...</p>
      </section>
    );
  }

  if (geoState.status === 'unavailable') {
    return (
      <section className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-100 text-orange-700">
          <MapPinIcon className="h-9 w-9" />
        </div>
        <h3 className="mt-4 text-lg font-black text-slate-950">GPS indisponible</h3>
        <p className="mt-2 text-sm leading-6 text-orange-900">{geoState.message}</p>
        {canRetry !== false && (
          <button
            className="mt-5 min-h-14 rounded-lg bg-orange-600 px-5 text-sm font-bold text-white"
            onClick={onRetry}
            type="button"
          >
            Réessayer
          </button>
        )}
      </section>
    );
  }

  const distance = selectedSite?.distanceKm ?? null;
  const inRadius = Boolean(selectedSite && distance !== null && !outsideRadius);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-panel">
      <div
        className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full border-8 ${
          inRadius ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        <MapPinIcon className="h-12 w-12" />
      </div>
      <h3 className="mt-4 text-lg font-black text-slate-950">
        {selectedSite ? selectedSite.name : 'Position recuperee'}
      </h3>
      {selectedSite?.siteType === 'INTERVENTION_ZONE' ? (
        <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
          Zone d&apos;intervention
        </p>
      ) : null}
      <p className={`mt-2 text-sm font-bold ${inRadius ? 'text-emerald-700' : 'text-red-700'}`}>
        {selectedSite && distance !== null
          ? outsideRadius
            ? `${distance.toFixed(2)} km - rayon : ${selectedSite.radiusKm} km`
            : selectedSite.siteType === 'INTERVENTION_ZONE'
              ? `${distance.toFixed(2)} km de la zone`
              : `${distance.toFixed(2)} km du chantier`
          : 'Choisissez un chantier pour verifier le rayon'}
      </p>
    </section>
  );
}

function ManualSiteList({
  geoState,
  loading,
  nearbyQueryFetching,
  nearbySearchRequested,
  onSelect,
  onSearchNearby,
  selectedSiteId,
  sites,
}: Readonly<{
  geoState: GeoState;
  loading: boolean;
  nearbyQueryFetching: boolean;
  nearbySearchRequested: boolean;
  onSelect: (siteId: string) => void;
  onSearchNearby: () => void;
  selectedSiteId: string | null;
  sites: TodaySiteItem[];
}>) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Chantiers du jour
        </h3>
        <button
          className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-black text-slate-700"
          onClick={onSearchNearby}
          type="button"
        >
          <SearchIcon className="h-4 w-4" />
          Chercher autour
        </button>
      </div>
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      ) : sites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
          Aucun chantier assigne aujourd&apos;hui
        </div>
      ) : (
        <div className="space-y-2">
          {sites.map((site) => {
            const selectableSite = fromTodaySite(site, geoState);
            return (
              <button
                className={`w-full rounded-lg border p-4 text-left transition ${
                  selectedSiteId === site.id ? 'border-primary bg-primary/10' : 'border-slate-200 bg-white'
                }`}
                key={site.id}
                onClick={() => onSelect(site.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black text-slate-950">{site.name}</p>
                    <p className="mt-1 truncate text-sm text-slate-500">{site.address}</p>
                    {site.siteType === 'INTERVENTION_ZONE' ? (
                      <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-black text-emerald-700">
                        Zone d&apos;intervention
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs font-bold text-emerald-700">Assigne aujourd&apos;hui</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-primary">
                    {selectableSite.distanceKm === null ? 'N/A' : `${selectableSite.distanceKm.toFixed(2)} km`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {nearbySearchRequested && geoState.status !== 'ready' ? (
        <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">GPS requis pour chercher autour.</p>
      ) : null}
      {nearbySearchRequested && nearbyQueryFetching ? (
        <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-500">Recherche du chantier proche...</p>
      ) : null}
    </section>
  );
}

function NearbySuggestionCard({
  isAssignedToday,
  onSelect,
  site,
}: Readonly<{
  isAssignedToday: boolean;
  onSelect: () => void;
  site: NearbySiteItem;
}>) {
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Site proche detecte</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black text-slate-950">{site.name}</h3>
          <p className="mt-1 truncate text-sm text-slate-600">{site.address}</p>
          <p className="mt-2 text-xs font-bold text-sky-700">
            {isAssignedToday ? 'Assigne aujourd&apos;hui' : 'Non assigne aujourd&apos;hui'}
          </p>
        </div>
        <span className="shrink-0 text-sm font-bold text-sky-700">{site.distance.toFixed(2)} km</span>
      </div>
      <button
        className="mt-4 min-h-12 w-full rounded-lg border border-sky-300 bg-white px-4 text-sm font-bold text-sky-800"
        onClick={onSelect}
        type="button"
      >
        Choisir ce site
      </button>
    </section>
  );
}

function ActionButton({
  busy,
  disabled,
  label,
  onClick,
  tone,
}: Readonly<{
  busy: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  tone: 'danger' | 'primary' | 'success' | 'warning';
}>) {
  const toneClassName = {
    danger: 'bg-danger text-white',
    primary: 'bg-orange-600 text-white',
    success: 'bg-success text-white',
    warning: 'bg-warning text-slate-950',
  }[tone];

  return (
    <button
      className={`flex min-h-20 w-full items-center justify-center rounded-lg px-5 text-base font-black tracking-[0.08em] shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClassName}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {busy ? <Spinner className="h-6 w-6" /> : label}
    </button>
  );
}

function PostClockInPanel({
  busy,
  errorMessage,
  helperText,
  label,
  onPrimary,
  onSkip,
  primaryLabel,
  setValue,
  title,
  value,
}: Readonly<{
  busy: boolean;
  errorMessage: string | null;
  helperText?: string;
  label: string;
  onPrimary: () => void;
  onSkip: () => void;
  primaryLabel: string;
  setValue: (value: string) => void;
  title: string;
  value: string;
}>) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Pointage valide</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">{title}</h2>
      </div>
      <label className="block text-sm font-bold text-slate-700" htmlFor="post-clock-in-text">
        {label}
      </label>
      {helperText ? <p className="text-sm leading-6 text-slate-500">{helperText}</p> : null}
      <textarea
        className="min-h-36 w-full rounded-lg border border-slate-300 p-3 text-base outline-none focus:border-primary"
        id="post-clock-in-text"
        onChange={(event) => setValue(event.target.value)}
        value={value}
      />
      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <button
          className="min-h-14 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700"
          disabled={busy}
          onClick={onSkip}
          type="button"
        >
          Passer
        </button>
        <button
          className="flex min-h-14 items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
          disabled={busy || value.trim() === ''}
          onClick={onPrimary}
          type="button"
        >
          {busy ? <Spinner className="h-5 w-5" /> : primaryLabel}
        </button>
      </div>
    </section>
  );
}

function ConfirmationView({ submission }: Readonly<{ submission: Submission }>) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-panel">
      <div
        className={`mx-auto flex h-28 w-28 animate-pulse items-center justify-center rounded-full ${
          submission.offline ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {submission.offline ? <ClockIcon className="h-14 w-14" /> : <CheckIcon className="h-14 w-14" />}
      </div>
      <h2 className="mt-5 text-2xl font-black text-slate-950">
        {submission.offline ? 'Pointage en attente' : 'Pointage confirme'}
      </h2>
      <div className="mt-5 space-y-3 rounded-lg bg-slate-50 p-4 text-left text-sm">
        <SummaryRow label="Type" value={typeLabels[submission.type] ?? submission.type} />
        <SummaryRow label="Chantier" value={submission.siteName} />
        <SummaryRow label="Date" value={formatDate(submission.timestampLocal)} />
        <SummaryRow label="Heure" value={formatTime(submission.timestampLocal)} />
        {submission.durationSeconds !== null ? (
          <SummaryRow label="Duree" value={formatShortDuration(submission.durationSeconds)} />
        ) : null}
      </div>
      <p className="mt-5 text-sm font-semibold text-slate-500">Retour accueil automatique...</p>
    </section>
  );
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="truncate font-bold text-slate-950">{value}</span>
    </div>
  );
}

function fromTodaySite(site: TodaySiteItem, geoState: GeoState): SelectableSite {
  const distanceKm =
    geoState.status === 'ready'
      ? haversineDistanceKm(
          { latitude: geoState.latitude, longitude: geoState.longitude },
          { latitude: site.latitude, longitude: site.longitude },
        )
      : null;

  return {
    id: site.id,
    name: site.name,
    address: site.address,
    latitude: site.latitude,
    longitude: site.longitude,
    radiusKm: site.radiusKm,
    distanceKm,
    siteType: site.siteType,
  };
}

function fromNearbySite(site: NearbySiteItem): SelectableSite {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    latitude: null,
    longitude: null,
    radiusKm: site.radiusKm,
    distanceKm: site.distance,
    siteType: null,
  };
}

function findPendingNegotiationSession(items: OfflineClockInItem[], assignmentId: string | null): PendingNegotiationSession | null {
  const departuresByArrival = new Set(
    items
      .filter((item) => item.type === 'DEPARTURE' && item.negotiationSessionClientId)
      .map((item) => item.negotiationSessionClientId),
  );
  const arrivals = items
    .filter((item) =>
      item.type === 'ARRIVAL' &&
      Boolean(item.negotiationAssignmentId) &&
      (!assignmentId || item.negotiationAssignmentId === assignmentId) &&
      !departuresByArrival.has(item.clientId),
    )
    .sort((left, right) => right.timestampLocal.localeCompare(left.timestampLocal));
  const arrival = arrivals[0];

  if (!arrival) {
    return null;
  }

  return {
    clientId: arrival.clientId,
    startTime: arrival.timestampLocal,
    siteName: arrival.siteName,
    negotiationAssignmentId: arrival.negotiationAssignmentId ?? null,
  };
}

function getNegotiationSessionLabel(session: NonNullable<MobileNegotiationDay['openSession']> | PendingNegotiationSession) {
  if ('siteName' in session) {
    return session.siteName;
  }

  return session.assignment?.zone?.name ?? session.assignment?.plannedZone ?? session.project?.name ?? null;
}

function buildOfflineSessionStatus(
  context:
    | { contextType: 'SITE'; siteId: string }
    | { contextType: 'FREE_MISSION'; freeMissionId: string }
    | { contextType: 'OFFICE'; officeLocationId: string | null; officeClockInLocation: OfficeClockInLocation | null },
  serverItems: ClockInRecordItem[],
  pendingItems: Awaited<ReturnType<typeof getPendingOfflineClockIns>>,
) {
  return buildLocalSessionStatus(context, serverItems, pendingItems);
}

async function readApiMessage(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message ?? fallback;
  } catch {
    return fallback;
  }
}

function parseIntent(value: string | null): ClockInIntent | null {
  if (value === 'arrival' || value === 'departure' || value === 'pause-start' || value === 'pause-end') {
    return value;
  }

  return null;
}

function elapsedSeconds(startedAt: string | null | undefined, now: number, fallback: number | null | undefined) {
  if (startedAt) {
    return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  }

  return Math.max(0, fallback ?? 0);
}

function formatShortDuration(totalSeconds: number) {
  const totalMinutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }

  return `${minutes}min`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatQuantity(value: number | null) {
  if (value === null) return '';
  return new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatClockContext(value: 'SITE' | 'FREE_MISSION' | 'OFFICE') {
  if (value === 'OFFICE') return 'Bureau';
  if (value === 'FREE_MISSION') return 'Zone';
  return 'Chantier';
}

function getFleetZoneLabel(assignment: { zoneName?: string | null; action: string; siteName: string; projectName?: string | null }) {
  return assignment.zoneName ?? assignment.action ?? assignment.siteName ?? assignment.projectName ?? 'Zone parc auto';
}
function buildZoneClockInComment({
  actualZone,
  specificPlace,
  comment,
}: {
  actualZone: string;
  specificPlace: string;
  comment: string;
}) {
  const lines = [`Zone reelle : ${actualZone.trim()}`];
  const trimmedPlace = specificPlace.trim();
  const trimmedComment = comment.trim();

  if (trimmedPlace) {
    lines.push(`Lieu/quartier : ${trimmedPlace}`);
  }

  if (trimmedComment) {
    lines.push(`Commentaire : ${trimmedComment}`);
  }

  return lines.join('\n');
}

function isAfterLateThreshold(value: number | string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const hour = date.getHours();
  const minute = date.getMinutes();
  return hour > 8 || (hour === 8 && minute > 30);
}

function Spinner({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function MapPinIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function BuildingIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M4 21h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 8h1M14 8h1M9 12h1M14 12h1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M10 21v-5h4v5" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function NavigationIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="m12 2 7 19-7-4-7 4 7-19Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />,
  );
}

function SearchIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function CheckIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="m5 12 4 4 10-10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />,
  );
}

function ClockIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}
