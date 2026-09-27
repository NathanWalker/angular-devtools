import { defineEventHandler, getQuery } from 'h3';
import { PRODUCTS } from '../../../../data/catalog';

export default defineEventHandler((event) => {
  const { category } = getQuery(event);
  return category ? PRODUCTS.filter((p) => p.category === category) : PRODUCTS;
});
