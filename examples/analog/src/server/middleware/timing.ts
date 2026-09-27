import { defineEventHandler, setResponseHeader } from 'h3';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'x-demo', 'analog-shop');
});
