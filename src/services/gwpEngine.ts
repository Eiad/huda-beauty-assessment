import gwpRules from '../config/gwpRules.json';

export interface CartLineItem {
  productId: string;
  variantId: string;
  title: string;
  quantity: number;
  price: string;
  tags?: string[];
}

export interface CartPayload {
  currency: string;
  lineItems: CartLineItem[];
}

interface GiftItem {
  productId: string;
  title: string;
  variantId: string;
}

export interface GwpResult {
  unlocked: boolean;
  gifts: GiftItem[];
  amountNeeded: number | null;
  currency: string;
  appliedRules: string[];
  message: string;
}

type GwpRule = {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  gift: GiftItem;
  currency?: string;
  threshold?: number;
  collectionTag?: string;
};

function cartTotal(lineItems: CartLineItem[]): number {
  return lineItems.reduce((sum, item) => {
    return sum + parseFloat(item.price) * item.quantity;
  }, 0);
}

function evaluateThresholdRule(
  rule: GwpRule & { threshold: number; currency: string },
  cart: CartPayload
) {
  if (cart.currency !== rule.currency) return null;
  const total = cartTotal(cart.lineItems);
  if (total >= rule.threshold) {
    return { unlocked: true, amountNeeded: 0, gift: rule.gift };
  }
  return {
    unlocked: false,
    amountNeeded: parseFloat((rule.threshold - total).toFixed(2)),
    gift: null,
  };
}

function evaluateCollectionRule(
  rule: GwpRule & { collectionTag: string },
  cart: CartPayload
) {
  const hasCollectionItem = cart.lineItems.some(
    (item) => item.tags && item.tags.includes(rule.collectionTag)
  );
  return {
    unlocked: hasCollectionItem,
    gift: hasCollectionItem ? rule.gift : null,
  };
}

export function evaluateGwp(cart: CartPayload): GwpResult {
  if (!cart.lineItems || cart.lineItems.length === 0) {
    return {
      unlocked: false,
      gifts: [],
      amountNeeded: null,
      currency: cart.currency,
      appliedRules: [],
      message: 'Cart is empty.',
    };
  }

  const activeRules = (gwpRules as GwpRule[]).filter((r) => r.enabled);
  const unlockedGifts: GiftItem[] = [];
  const appliedRules: string[] = [];
  let minAmountNeeded: number | null = null;

  for (const rule of activeRules) {
    if (rule.type === 'cart_threshold' && rule.threshold !== undefined && rule.currency !== undefined) {
      const result = evaluateThresholdRule(
        rule as GwpRule & { threshold: number; currency: string },
        cart
      );
      if (result) {
        if (result.unlocked && result.gift) {
          unlockedGifts.push(result.gift);
          appliedRules.push(rule.id);
        } else if (!result.unlocked && result.amountNeeded !== null) {
          if (minAmountNeeded === null || result.amountNeeded < minAmountNeeded) {
            minAmountNeeded = result.amountNeeded;
          }
        }
      }
    } else if (rule.type === 'product_collection' && rule.collectionTag !== undefined) {
      const result = evaluateCollectionRule(
        rule as GwpRule & { collectionTag: string },
        cart
      );
      if (result.unlocked && result.gift) {
        unlockedGifts.push(result.gift);
        appliedRules.push(rule.id);
      }
    }
  }

  const unlocked = unlockedGifts.length > 0;
  return {
    unlocked,
    gifts: unlockedGifts,
    amountNeeded: unlocked ? null : minAmountNeeded,
    currency: cart.currency,
    appliedRules,
    message: unlocked
      ? `Congratulations! You've unlocked ${unlockedGifts.length} free gift(s).`
      : minAmountNeeded !== null
      ? `Spend ${cart.currency} ${minAmountNeeded.toFixed(2)} more to unlock a free gift.`
      : 'No active GWP promotions apply to your cart.',
  };
}
