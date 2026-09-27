import { defineEventHandler } from 'h3';
import { ORDERS, type OrderSummary } from '../../../../data/catalog';

export default defineEventHandler((): OrderSummary[] =>
  ORDERS.map(({ id, name, total, createdAt }) => ({ id, name, total, createdAt })),
);
