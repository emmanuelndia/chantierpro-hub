export type OfficeLocationItem = {
  id: string;
  name: string;
  address: string;
  city: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  isActive: boolean;
  createdAt: string;
};

export type OfficeLocationsResponse = {
  items: OfficeLocationItem[];
};

export type OfficeLocationPayload = {
  name: string;
  address: string;
  city?: string | null;
  latitude: number;
  longitude: number;
  radiusKm: number;
  isActive?: boolean;
};
