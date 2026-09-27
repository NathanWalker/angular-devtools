export interface Product {
  id: number;
  name: string;
  category: 'audio' | 'desk' | 'bags';
  price: number;
  stock: number;
  summary: string;
  image: string;
}

export const PRODUCTS: Product[] = [
  {
    id: 1,
    name: 'Studio Headphones',
    category: 'audio',
    price: 199,
    stock: 12,
    summary: 'Closed-back, 40 hours of battery.',
    image: '/products/studio-headphones.webp',
  },
  {
    id: 2,
    name: 'Desk Lamp',
    category: 'desk',
    price: 59,
    stock: 30,
    summary: 'Balanced arm, warm light, USB-C.',
    image: '/products/desk-lamp.webp',
  },
  {
    id: 3,
    name: 'Travel Backpack',
    category: 'bags',
    price: 129,
    stock: 0,
    summary: 'Carry-on size with a laptop sleeve.',
    image: '/products/travel-backpack.webp',
  },
  {
    id: 4,
    name: 'Mechanical Keyboard',
    category: 'desk',
    price: 149,
    stock: 8,
    summary: 'Hot-swappable, 75% layout.',
    image: '/products/mechanical-keyboard.webp',
  },
  {
    id: 5,
    name: 'Bluetooth Speaker',
    category: 'audio',
    price: 89,
    stock: 21,
    summary: 'Waterproof, pairs in stereo.',
    image: '/products/bluetooth-speaker.webp',
  },
  {
    id: 6,
    name: 'Messenger Bag',
    category: 'bags',
    price: 79,
    stock: 44,
    summary: 'Water-resistant, fits 14 inch laptops.',
    image: '/products/messenger-bag.webp',
  },
];

export interface Order {
  id: number;
  name: string;
  email: string;
  items: { productId: number; quantity: number }[];
  total: number;
  createdAt: string;
}

export type OrderSummary = Pick<Order, 'id' | 'name' | 'total' | 'createdAt'>;

export const ORDERS: Order[] = [
  {
    id: 1001,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    items: [{ productId: 1, quantity: 1 }],
    total: 199,
    createdAt: '2026-09-20T10:00:00.000Z',
  },
];

export function findProduct(id: number): Product | undefined {
  return PRODUCTS.find((product) => product.id === id);
}
