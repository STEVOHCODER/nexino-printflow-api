import { config } from '../config';

export interface PricingRequest {
  pageCount: number;
  copies: number;
  colorMode: 'BW' | 'COLOR' | 'MIXED';
  paperSize: 'A3' | 'A4' | 'A5' | 'LETTER';
  duplex: boolean;
  colorPages?: number[];
  coverColor?: boolean;
  stationPricing?: StationPricing | null;
}

export interface StationPricing {
  bwPerPage: number;
  colorPerPage: number;
  paperA3: number;
  paperA5: number;
  duplexDiscount: number;
}

export interface PricingResponse {
  pricePerPage: number;
  pageCount: number;
  copies: number;
  paperSizeMultiplier: number;
  duplexDiscount: number;
  totalPrice: number;
  currency: string;
  colorPagesCount: number;
  bwPagesCount: number;
  breakdown: {
    colorPages: number;
    bwPages: number;
    colorPrice: number;
    bwPrice: number;
  };
}

const PAPER_SIZE_MULTIPLIERS: Record<string, number> = {
  A5: 0.75,
  A4: 1.0,
  LETTER: 1.0,
  A3: 1.5,
};

function getStationPricing(stationPricing?: StationPricing | null) {
  return {
    bwPerPage: stationPricing?.bwPerPage ?? config.pricing.perPageBw,
    colorPerPage: stationPricing?.colorPerPage ?? config.pricing.perPageColor,
    paperA3: stationPricing?.paperA3 ?? 1.5,
    paperA5: stationPricing?.paperA5 ?? 0.75,
    duplexDiscount: stationPricing?.duplexDiscount ?? 0.9,
  };
}

export function calculatePrice(request: PricingRequest): PricingResponse {
  const pricing = getStationPricing(request.stationPricing);
  const paperMultiplier = PAPER_SIZE_MULTIPLIERS[request.paperSize] || 1.0;

  let colorPagesCount = 0;
  let bwPagesCount = 0;

  if (request.colorMode === 'COLOR') {
    colorPagesCount = request.pageCount;
    bwPagesCount = 0;
  } else if (request.colorMode === 'BW') {
    colorPagesCount = 0;
    bwPagesCount = request.pageCount;
  } else {
    // MIXED mode
    colorPagesCount = request.colorPages?.length || 0;
    bwPagesCount = request.pageCount - colorPagesCount;
  }

  const colorPrice = Math.round(pricing.colorPerPage * paperMultiplier * colorPagesCount);
  const bwPrice = Math.round(pricing.bwPerPage * paperMultiplier * bwPagesCount);
  const pagesTotal = (colorPrice + bwPrice) * request.copies;

  let totalPrice = pagesTotal;
  let duplexDiscount = 1.0;
  if (request.duplex) {
    duplexDiscount = pricing.duplexDiscount;
    totalPrice = Math.round(totalPrice * duplexDiscount);
  }

  const pricePerPage = colorPagesCount > 0 || bwPagesCount > 0
    ? Math.round(totalPrice / (request.pageCount * request.copies))
    : 0;

  return {
    pricePerPage,
    pageCount: request.pageCount,
    copies: request.copies,
    paperSizeMultiplier: paperMultiplier,
    duplexDiscount: request.duplex ? duplexDiscount : 1.0,
    totalPrice,
    currency: config.currency,
    colorPagesCount,
    bwPagesCount,
    breakdown: {
      colorPages: colorPagesCount,
      bwPages: bwPagesCount,
      colorPrice,
      bwPrice,
    },
  };
}

export function calculatePricePerPage(colorMode: string, paperSize: string, stationPricing?: StationPricing | null): number {
  const pricing = getStationPricing(stationPricing);
  const multiplier = PAPER_SIZE_MULTIPLIERS[paperSize] || 1.0;
  const base = colorMode === 'COLOR' ? pricing.colorPerPage : pricing.bwPerPage;
  return Math.round(base * multiplier);
}
