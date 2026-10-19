// Response shapes from https://docs.trackjs.com/data-api/ and the official client
// (github.com/TrackJs/trackjs-api-client-js). Fields are optional where the API is
// known to omit them or where the docs and client disagree.

export interface PagedResponse<TItem, TMeta = PageMetadata> {
  data: TItem[];
  metadata: TMeta;
}

export interface PageMetadata {
  startDate?: string;
  endDate?: string;
  totalCount?: number;
  page?: number;
  size?: number;
  hasMore?: boolean;
  trackJsUrl?: string;
}

/** GET /errors */
export interface TrackJsError {
  id: string;
  message?: string;
  timestamp?: string;
  url?: string;
  browserName?: string;
  browserVersion?: string;
  entry?: string;
  line?: number;
  column?: number;
  file?: string;
  userId?: string;
  sessionId?: string;
  status?: string;
  trackJsUrl?: string;
  stackTrace?: string[];
  metadata?: { key: string; value: string }[];
}

/** GET /errors/daily and /errors/hourly */
export interface ErrorPeriod {
  key: string;
  count: number;
  userCount?: number;
  trackJsUrl?: string;
}

/** GET /errors/messages */
export interface ErrorMessageGroup {
  key: string;
  count: number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  status?: string;
  trackJsUrl?: string;
}

/** GET /errors/urls */
export interface ErrorUrlGroup {
  key: string;
  count: number;
  userCount?: number;
  trackJsUrl?: string;
}

/** GET /hits/daily and /hits/hourly */
export interface PageViewPeriod {
  key: string;
  count: number;
}

/** GET /usage/hourly (bare array, not wrapped in data/metadata) */
export interface UsageHour {
  timestamp: string;
  pageViews: number;
  totalErrors: number;
  processedErrors: number;
  ignoredErrors: number;
  droppedErrors: number;
  errorsPerPageView: number;
}
