import { ColorMode, PaperSize, PricingRequest, PricingResponse } from '../types';
import { config } from '../config';

const PAPER_SIZE_MULTIPLIERS: Record<PaperSize, number> = {
  [PaperSize.A5]: 0.75,
  [PaperSize.A4]: 1.0,
  [PaperSize.LETTER]: 1.0,
  [PaperSize.A3]: 1.5,
};

const DUPLEX_DISCOUNT = 0.9;

export function calculatePrice(request: PricingRequest): PricingResponse {
  const basePricePerPage = request.colorMode === ColorMode.COLOR
    ? config.pricing.perPageColor
    : config.pricing.perPageBw;

  const paperSizeMultiplier = PAPER_SIZE_MULTIPLIERS[request.paperSize];
  const effectivePricePerPage = Math.round(basePricePerPage * paperSizeMultiplier);

  const totalPages = request.pageCount * request.copies;
  let totalPrice = effectivePricePerPage * totalPages;

  let duplexDiscount = 1.0;
  if (request.duplex) {
    duplexDiscount = DUPLEX_DISCOUNT;
    totalPrice = Math.round(totalPrice * duplexDiscount);
  }

  return {
    pricePerPage: effectivePricePerPage,
    pageCount: request.pageCount,
    copies: request.copies,
    paperSizeMultiplier,
    duplexDiscount: request.duplex ? DUPLEX_DISCOUNT : 1.0,
    totalPrice,
    currency: config.currency,
  };
}

export function calculatePricePerPage(colorMode: ColorMode, paperSize: PaperSize): number {
  const basePrice = colorMode === ColorMode.COLOR
    ? config.pricing.perPageColor
    : config.pricing.perPageBw;
  return Math.round(basePrice * PAPER_SIZE_MULTIPLIERS[paperSize]);
}
