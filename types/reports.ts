export type CreateReportInput = {
  content: string;
  clockInRecordId: string;
};

export type ReportItem = {
  id: string;
  siteId: string;
  userId: string;
  content: string;
  validationStatus: 'SUBMITTED' | 'VALIDATED_FOR_CLIENT';
  validatedForClientAt: string | null;
  validatedForClientBy: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  } | null;
  submittedAt: string;
  createdAt: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  session: {
    id: string;
    type: string;
    date: string;
    time: string;
  };
};

export type ReportDetail = ReportItem;

export type PaginatedReportsResponse = {
  items: ReportItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type NearbySiteItem = {
  id: string;
  name: string;
  address: string;
  distance: number;
  radiusKm: number;
};

export type ReportApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMPTY_CONTENT'
  | 'ALREADY_VALIDATED';
