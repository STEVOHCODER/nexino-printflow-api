export enum PrinterState {
  IDLE = 'IDLE',
  PRINTING = 'PRINTING',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR',
  OFFLINE = 'OFFLINE',
}

export enum PaperStatus {
  UNKNOWN = 'UNKNOWN',
  OK = 'OK',
  LOW = 'LOW',
  EMPTY = 'EMPTY',
}

export enum TonerStatus {
  UNKNOWN = 'UNKNOWN',
  OK = 'OK',
  LOW = 'LOW',
  EMPTY = 'EMPTY',
}

export enum ColorMode {
  BW = 'BW',
  COLOR = 'COLOR',
}

export enum PaperSize {
  A3 = 'A3',
  A4 = 'A4',
  A5 = 'A5',
  LETTER = 'LETTER',
}

export enum PrintJobStatus {
  CREATED = 'CREATED',
  FILE_UPLOADED = 'FILE_UPLOADED',
  PRICE_CALCULATED = 'PRICE_CALCULATED',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PAYMENT_PROCESSING = 'PAYMENT_PROCESSING',
  PAID = 'PAID',
  AUTHORIZED = 'AUTHORIZED',
  QUEUED = 'QUEUED',
  PRINTING = 'PRINTING',
  COMPLETED = 'COMPLETED',
  PRINT_FAILED = 'PRINT_FAILED',
  PRINTER_OFFLINE = 'PRINTER_OFFLINE',
  PRINTER_ERROR = 'PRINTER_ERROR',
  CANCELLED = 'CANCELLED',
  REFUND_PENDING = 'REFUND_PENDING',
  REFUNDED = 'REFUNDED',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum AuthorizationStatus {
  PENDING = 'PENDING',
  AUTHORIZED = 'AUTHORIZED',
  REJECTED = 'REJECTED',
}

export enum PaymentProvider {
  MOCK = 'MOCK',
  MOBILE_MONEY = 'MOBILE_MONEY',
  CARD = 'CARD',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginatedRequest {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface StationResponse {
  id: string;
  stationCode: string;
  name: string;
  location: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrinterResponse {
  id: string;
  name: string;
  stationId: string;
  printerUri: string;
  adapterType: string;
  isOnline: boolean;
  currentState: PrinterState;
  paperStatus: PaperStatus;
  paperLevel: number | null;
  tonerStatus: TonerStatus;
  tonerLevel: number | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrintJobResponse {
  id: string;
  jobId: string;
  stationId: string;
  printerId: string | null;
  fileId: string;
  originalFilename: string;
  pageCount: number;
  pageRange: string | null;
  copies: number;
  colorMode: ColorMode;
  paperSize: PaperSize;
  duplex: boolean;
  price: number;
  currency: string;
  paymentStatus: PaymentStatus;
  authorizationStatus: AuthorizationStatus;
  printStatus: PrintJobStatus;
  errorMessage: string | null;
  paymentRef: string | null;
  authorizationToken: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface UploadResponse {
  fileId: string;
  originalFilename: string;
  pageCount: number;
  fileSize: number;
}

export interface PricingRequest {
  pageCount: number;
  copies: number;
  colorMode: ColorMode;
  paperSize: PaperSize;
  duplex: boolean;
}

export interface PricingResponse {
  pricePerPage: number;
  pageCount: number;
  copies: number;
  paperSizeMultiplier: number;
  duplexDiscount: number;
  totalPrice: number;
  currency: string;
}

export interface CreateJobRequest {
  fileId: string;
  stationId: string;
  stationCode?: string;
  pageRange?: string;
  copies?: number;
  colorMode?: ColorMode;
  paperSize?: PaperSize;
  duplex?: boolean;
  idempotencyKey?: string;
}

export interface PaymentRequest {
  provider: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRegisterRequest {
  agentId: string;
  stationId: string;
  hostname: string;
  platform: string;
}

export interface AgentHeartbeatRequest {
  agentId: string;
  printers: Array<{
    printerId: string;
    status: PrinterState;
    paperStatus?: PaperStatus;
    paperLevel?: number;
    tonerStatus?: TonerStatus;
    tonerLevel?: number;
  }>;
}

export interface AgentJobStatusRequest {
  agentId: string;
  status: PrintJobStatus;
  errorMessage?: string;
}

export interface AgentPrinterStatusRequest {
  status: PrinterState;
  paperStatus?: PaperStatus;
  paperLevel?: number;
  tonerStatus?: TonerStatus;
  tonerLevel?: number;
}

export interface DashboardStats {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  totalRevenue: number;
  totalStations: number;
  totalPrinters: number;
  onlinePrinters: number;
  recentJobs: PrintJobResponse[];
}

export interface RevenueReport {
  totalRevenue: number;
  totalTransactions: number;
  revenueByDay: Array<{
    date: string;
    revenue: number;
    transactions: number;
  }>;
  revenueByStation: Array<{
    stationId: string;
    stationName: string;
    revenue: number;
    jobs: number;
  }>;
}

export interface SystemAlert {
  id: string;
  type: 'PRINTER_OFFLINE' | 'PRINTER_ERROR' | 'LOW_PAPER' | 'LOW_TONER' | 'PAYMENT_FAILURE';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  entityId: string;
  entityType: string;
  createdAt: Date;
}
