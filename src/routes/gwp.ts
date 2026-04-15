import { Router, Request, Response, NextFunction } from 'express';
import { evaluateGwp } from '../services/gwpEngine';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

router.post('/check', (req: Request, res: Response, next: NextFunction) => {
  const { currency, lineItems } = req.body;

  if (!currency || typeof currency !== 'string') {
    return next(new AppError(400, 'Request body must contain currency (string)'));
  }
  if (!Array.isArray(lineItems)) {
    return next(new AppError(400, 'Request body must contain lineItems (array)'));
  }

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    if (!item || typeof item.price !== 'string' || typeof item.quantity !== 'number') {
      return next(new AppError(400, `lineItems[${i}] must have a string "price" and numeric "quantity"`));
    }
  }

  const result = evaluateGwp({ currency, lineItems });

  logger.info({
    event: 'gwp_evaluated',
    currency,
    cartItemCount: lineItems.length,
    unlocked: result.unlocked,
    appliedRules: result.appliedRules,
  });

  res.json(result);
});

export default router;
