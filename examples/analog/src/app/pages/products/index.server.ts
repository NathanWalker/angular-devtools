import type { PageServerLoad } from '@analogjs/router';
import { PRODUCTS } from '../../../server/data/catalog';

export const load = async (_context: PageServerLoad) => ({ products: PRODUCTS });
