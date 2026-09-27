import type { PageServerLoad } from '@analogjs/router';
import { findProduct } from '../../../server/data/catalog';

export const load = async ({ params }: PageServerLoad) => ({
  product: findProduct(Number(params?.['id'])) ?? null,
});
