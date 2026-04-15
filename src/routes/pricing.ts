import { Router, Request, Response, NextFunction } from 'express';
import { getMarketPricing } from '../services/pricingService';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

router.get('/', (req: Request, res: Response, next: NextFunction) => {
  const { productId, market } = req.query;

  if (!productId || typeof productId !== 'string') {
    return next(new AppError(400, 'Query parameter "productId" is required'));
  }
  if (!market || typeof market !== 'string') {
    return next(new AppError(400, 'Query parameter "market" is required (e.g. en-AE, en-US, en-GB, en-SA)'));
  }

  try {
    const pricing = getMarketPricing(productId, market);

    logger.info({
      event: 'pricing_requested',
      productId,
      market,
      finalPrice: pricing.finalPrice,
      currency: pricing.currency,
    });

    res.json(pricing);
  } catch (err) {
    next(err);
  }
});

export default router;
