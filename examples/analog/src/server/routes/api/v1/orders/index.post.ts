import { createError, defineEventHandler, readBody } from 'h3';
import { ORDERS, findProduct, type Order } from '../../../../data/catalog';

interface OrderRequest {
  name?: string;
  email?: string;
  items?: { productId: number; quantity: number }[];
}

export default defineEventHandler(async (event) => {
  const body = await readBody<OrderRequest>(event);
  const errors: { field: string; message: string }[] = [];
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email : '';
  if (!name) errors.push({ field: 'name', message: 'Name is required' });
  if (!email.includes('@')) errors.push({ field: 'email', message: 'Enter a valid email' });
  if (email.endsWith('@blocked.test')) {
    errors.push({ field: 'email', message: 'This email is blocked' });
  }
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) errors.push({ field: 'items', message: 'The cart is empty' });
  const wanted = new Map<number, number>();
  for (const item of items) {
    if (
      !Number.isInteger(item?.productId) ||
      !Number.isInteger(item?.quantity) ||
      item.quantity < 1
    ) {
      errors.push({ field: 'items', message: 'Each quantity must be a whole number above 0' });
      break;
    }
    wanted.set(item.productId, (wanted.get(item.productId) ?? 0) + item.quantity);
  }
  for (const [productId, quantity] of wanted) {
    const product = findProduct(productId);
    if (!product || product.stock < quantity) {
      errors.push({ field: 'items', message: `${product?.name ?? 'A product'} is out of stock` });
    }
  }
  if (errors.length) throw createError({ statusCode: 422, data: { errors } });
  const order: Order = {
    id: 1000 + ORDERS.length + 1,
    name,
    email,
    items,
    total: items.reduce(
      (sum, item) => sum + (findProduct(item.productId)?.price ?? 0) * item.quantity,
      0,
    ),
    createdAt: new Date().toISOString(),
  };
  for (const [productId, quantity] of wanted) findProduct(productId)!.stock -= quantity;
  ORDERS.push(order);
  return order;
});
