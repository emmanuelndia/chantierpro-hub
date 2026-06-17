export type FleetVehicleRoleInAssignment = 'DRIVER' | 'APPRENTICE';

export type FleetVehiclePersonSummary = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
};

export type FleetVehicleAssignmentSummary = {
  id: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  driver: FleetVehiclePersonSummary;
  apprentice: FleetVehiclePersonSummary | null;
};

export type FleetVehicleSummary = {
  id: string;
  registrationNumber: string;
  brand: string;
  model: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  activeAssignment: FleetVehicleAssignmentSummary | null;
};

export type FleetVehicleCurrentAssignment = {
  assignmentId: string;
  vehicleId: string;
  registrationNumber: string;
  brand: string;
  model: string;
  roleInVehicle: FleetVehicleRoleInAssignment;
  startDate: string;
};

export type FleetVehiclesResponse = {
  items: FleetVehicleSummary[];
  availableResources: FleetVehiclePersonSummary[];
};

export type FleetVehiclePayload = {
  registrationNumber: string;
  brand: string;
  model: string;
  isActive: boolean;
  driverUserId: string;
  apprenticeUserId?: string | null;
  startDate?: string | null;
};

export type FleetVehicleImportPreviewRow = {
  id: string;
  rowNumber: number;
  registrationNumber: string;
  brand: string;
  model: string;
  driverLabel: string;
  apprenticeLabel: string | null;
  resolvedDriverUserId: string | null;
  resolvedApprenticeUserId: string | null;
  valid: boolean;
  errors: string[];
};

export type FleetVehicleImportResponse = {
  mode: 'preview' | 'commit';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdVehicles: number;
  updatedVehicles: number;
  createdAssignments: number;
  closedAssignments: number;
  rows: FleetVehicleImportPreviewRow[];
};
