export type MobilePhotoQuality = 'high' | 'normal' | 'economy';

export const MOBILE_PHOTO_QUALITY_STORAGE_KEY = 'chantierpro:mobile-photo-quality';

export const MOBILE_PHOTO_QUALITY_OPTIONS: {
  value: MobilePhotoQuality;
  label: string;
  detail: string;
  jpegQuality: number;
}[] = [
  {
    value: 'high',
    label: 'Haute',
    detail: 'Qualite maximale',
    jpegQuality: 0.92,
  },
  {
    value: 'normal',
    label: 'Normale',
    detail: '80%',
    jpegQuality: 0.8,
  },
  {
    value: 'economy',
    label: 'Économique',
    detail: '50%',
    jpegQuality: 0.5,
  },
];

const DEFAULT_MOBILE_PHOTO_QUALITY: MobilePhotoQuality = 'normal';

export function isMobilePhotoQuality(value: unknown): value is MobilePhotoQuality {
  return value === 'high' || value === 'normal' || value === 'economy';
}

export function getStoredMobilePhotoQuality(): MobilePhotoQuality {
  if (typeof window === 'undefined') {
    return DEFAULT_MOBILE_PHOTO_QUALITY;
  }

  const storedValue = window.localStorage.getItem(MOBILE_PHOTO_QUALITY_STORAGE_KEY);
  return isMobilePhotoQuality(storedValue) ? storedValue : DEFAULT_MOBILE_PHOTO_QUALITY;
}

export function setStoredMobilePhotoQuality(value: MobilePhotoQuality) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(MOBILE_PHOTO_QUALITY_STORAGE_KEY, value);
}

export function getMobilePhotoJpegQuality(value: MobilePhotoQuality = getStoredMobilePhotoQuality()) {
  return MOBILE_PHOTO_QUALITY_OPTIONS.find((option) => option.value === value)?.jpegQuality ?? 0.8;
}
