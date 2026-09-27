import type { PageServerLoad } from '@analogjs/router';
import { PRODUCTS } from '../../server/data/catalog';

export const load = async (_context: PageServerLoad) => ({
  tagline: 'Headphones, lamps and bags, shipped in two days.',
  featured: PRODUCTS.filter((product) => product.stock > 0).slice(0, 3),
});
