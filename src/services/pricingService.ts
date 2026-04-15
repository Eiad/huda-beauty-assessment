import catalog from '../config/marketPricing.json';
import { AppError } from '../middleware/errorHandler';

interface DiscountConfig {
  type: 'percentage' | 'fixed';
  value: number;
}

interface MarketConfig {
  currency: string;
  basePrice: number;
  discount: DiscountConfig | null;
  freeShippingThreshold: number;
}

interface PricingResponse {
  productId: string;
  productTitle: string;
  market: string;
  currency: string;
  basePrice: number;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  finalPrice: number;
  meetsShippingThreshold: boolean;
  freeShippingThreshold: number;
}

const products = catalog.products as Record<string, { title: string; markets: Record<string, MarketConfig> }>;
const SUPPORTED_MARKETS = [...new Set(
  Object.values(products).flatMap((p) => Object.keys(p.markets))
)];

export function getMarketPricing(productId: string, market: string): PricingResponse {
  if (!SUPPORTED_MARKETS.includes(market)) {
    throw new AppError(400, `Unsupported market: ${market}. Supported markets: ${SUPPORTED_MARKETS.join(', ')}`);
  }

  const product = products[productId];
  if (!product) {
    throw new AppError(404, `Product not found: ${productId}`);
  }

  const marketData = product.markets[market];
  if (!marketData) {
    throw new AppError(404, `Product ${productId} is not available in market ${market}`);
  }

  let discountAmount = 0;
  let discountType: string | null = null;
  let discountValue: number | null = null;

  if (marketData.discount) {
    discountType = marketData.discount.type;
    discountValue = marketData.discount.value;
    if (marketData.discount.type === 'percentage') {
      discountAmount = parseFloat((marketData.basePrice * (marketData.discount.value / 100)).toFixed(2));
    } else {
      discountAmount = marketData.discount.value;
    }
  }

  const finalPrice = parseFloat(Math.max(0, marketData.basePrice - discountAmount).toFixed(2));

  return {
    productId,
    productTitle: product.title,
    market,
    currency: marketData.currency,
    basePrice: marketData.basePrice,
    discountType,
    discountValue,
    discountAmount,
    finalPrice,
    meetsShippingThreshold: finalPrice >= marketData.freeShippingThreshold,
    freeShippingThreshold: marketData.freeShippingThreshold,
  };
}
