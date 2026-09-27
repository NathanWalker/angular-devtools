import { createError, defineEventHandler, getRouterParam } from 'h3';
import { findProduct } from '../../../../data/catalog';

export default defineEventHandler((event) => {
  const product = findProduct(Number(getRouterParam(event, 'id')));
  if (!product) throw createError({ statusCode: 404, statusMessage: 'Product not found' });
  return product;
});
