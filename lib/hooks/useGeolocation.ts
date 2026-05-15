'use client';

import { useCallback, useEffect, useState } from 'react';
import { getRecentMobileGpsPosition, rememberMobileGpsPosition, type MobileGpsPosition } from '@/lib/mobile-geolocation';

type GeolocationState = {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  loading: boolean;
  error: string | null;
  permissionState: 'prompt' | 'granted' | 'denied' | 'unsupported';
  source: MobileGpsPosition['source'] | null;
  capturedAt: string | null;
};

const ERROR_MESSAGES: Record<number, string> = {
  1: 'Permission refusée. Allez dans Paramètres > Site web > Localisation et autorisez ChantierPro.',
  2: 'GPS indisponible. Assurez-vous d\'être à l\'extérieur et que la localisation est activée sur votre téléphone.',
  3: 'Délai dépassé. Réessayez en vous déplaçant vers l\'extérieur.',
};

export function useGeolocation(options: {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
} = {}) {
  const {
    enableHighAccuracy = true,
    timeout = 15000,
    maximumAge = 0,
  } = options;

  const [state, setState] = useState<GeolocationState>({
    latitude: null,
    longitude: null,
    accuracy: null,
    loading: true,
    error: null,
    permissionState: 'prompt',
    source: null,
    capturedAt: null,
  });

  const handleLocationError = useCallback(async (error: GeolocationPositionError) => {
    const cachedPosition = await getRecentMobileGpsPosition();
    if (cachedPosition) {
      setState({
        latitude: cachedPosition.latitude,
        longitude: cachedPosition.longitude,
        accuracy: cachedPosition.accuracy,
        loading: false,
        error: null,
        permissionState: error.code === 1 ? 'denied' : 'prompt',
        source: 'CACHED',
        capturedAt: cachedPosition.capturedAt,
      });
      return;
    }

    const errorMessage = ERROR_MESSAGES[error.code] ?? 'Erreur de localisation inconnue.';
    const permissionState = error.code === 1 ? 'denied' : 'prompt';

    setState(prev => ({
      ...prev,
      loading: false,
      error: errorMessage,
      permissionState,
      source: null,
      capturedAt: null,
    }));
  }, []);

  const requestLocation = useCallback(() => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    // Vérifier si la géolocalisation est supportée
    if (!('geolocation' in navigator)) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: 'La géolocalisation n\'est pas disponible sur cet appareil.',
        permissionState: 'unsupported',
      }));
      return;
    }

    // Tenter d'obtenir la position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const capturedAt = new Date(position.timestamp).toISOString();
        void rememberMobileGpsPosition({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt,
        });
        setState({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          loading: false,
          error: null,
          permissionState: 'granted',
          source: 'LIVE',
          capturedAt,
        });
      },
      (error) => {
        void handleLocationError(error);
      },
      {
        enableHighAccuracy,
        timeout,
        maximumAge,
      }
    );
  }, [enableHighAccuracy, handleLocationError, timeout, maximumAge]);

  // Demander la localisation au montage du composant
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  // Vérifier l'état de la permission si l'API est disponible
  useEffect(() => {
    if ('permissions' in navigator && 'geolocation' in navigator) {
      navigator.permissions.query({ name: 'geolocation' }).then((result) => {
        setState(prev => ({
          ...prev,
          permissionState: result.state,
        }));

        // Écouter les changements de permission
        const handleChange = () => {
          setState(prev => ({
            ...prev,
            permissionState: result.state,
          }));
        };

        result.addEventListener('change', handleChange);
        return () => {
          result.removeEventListener('change', handleChange);
        };
      }).catch(() => {
        // Ignorer les erreurs de query de permission
      });
    }
  }, []);

  return {
    ...state,
    refresh: requestLocation,
    isSupported: 'geolocation' in navigator,
    canRetry: state.error !== null && state.permissionState !== 'unsupported',
  };
}
