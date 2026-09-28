export type Region = 'Europe' | 'Asia' | 'Africa';

export interface Destination {
  id: string;
  name: string;
  country: string;
  region: Region;
  image: string;
  imageAlt: string;
  price: number;
  nights: number;
  rating: number;
  reviews: number;
  summary: string;
  description: string;
  highlights: string[];
  bestTime: string;
  seats: number;
  groupSize: number;
}

export const DESTINATIONS: Destination[] = [
  {
    id: 'istanbul',
    name: 'Istanbul',
    country: 'Türkiye',
    region: 'Europe',
    image: '/destinations/istanbul.webp',
    imageAlt: 'A ferry on the Bosphorus with the Süleymaniye Mosque above the old city',
    price: 990,
    nights: 6,
    rating: 4.9,
    reviews: 874,
    summary: 'Two continents, ferry rides at sunset and the best breakfast in the world.',
    description:
      'Wander the Grand Bazaar and Balat, take the ferry to Kadıköy for a food walk on the Asian side and watch the sunset over the Golden Horn from a rooftop in Galata. Mornings start with a proper Turkish breakfast.',
    highlights: ['Bosphorus ferry at sunset', 'Food walk in Kadıköy', 'Hagia Sophia and Topkapı'],
    bestTime: 'April to June, September to November',
    seats: 7,
    groupSize: 12,
  },
  {
    id: 'santorini',
    name: 'Santorini',
    country: 'Greece',
    region: 'Europe',
    image: '/destinations/santorini.webp',
    imageAlt: 'A blue dome above white houses on a cliff over the Aegean Sea',
    price: 1290,
    nights: 6,
    rating: 4.9,
    reviews: 412,
    summary: 'Cliffside villages, volcanic beaches and the calmest sunsets in the Aegean.',
    description:
      'Stay in a cave suite in Oia, sail around the caldera and spend slow afternoons on black sand beaches. The trip includes a wine tasting at a family vineyard in Pyrgos.',
    highlights: ['Caldera sailing trip', 'Cave suite in Oia', 'Vineyard tasting in Pyrgos'],
    bestTime: 'May to October',
    seats: 8,
    groupSize: 12,
  },
  {
    id: 'kyoto',
    name: 'Kyoto',
    country: 'Japan',
    region: 'Asia',
    image: '/destinations/kyoto.webp',
    imageAlt: 'A quiet stone street lined with wooden houses and lanterns at dusk',
    price: 1840,
    nights: 8,
    rating: 4.8,
    reviews: 538,
    summary: 'Temple mornings, lantern-lit streets and a tea ceremony in Gion.',
    description:
      'Walk the Higashiyama lanes before the crowds, visit Fushimi Inari at sunrise and join a tea ceremony with a local host. Nights are split between a ryokan and a design hotel.',
    highlights: ['Sunrise at Fushimi Inari', 'Tea ceremony in Gion', 'Two nights in a ryokan'],
    bestTime: 'March to May, October to November',
    seats: 3,
    groupSize: 12,
  },
  {
    id: 'lisbon',
    name: 'Lisbon',
    country: 'Portugal',
    region: 'Europe',
    image: '/destinations/lisbon.webp',
    imageAlt: 'A yellow tram climbing a narrow street between old buildings',
    price: 890,
    nights: 5,
    rating: 4.7,
    reviews: 689,
    summary: 'Tram 28, tiled facades and pastel de nata on every corner.',
    description:
      'Ride the historic trams through Alfama, take a day trip to Sintra and end each evening with fado in a small tavern. Your hotel sits between Chiado and the river.',
    highlights: ['Day trip to Sintra', 'Fado night in Alfama', 'Food walk in Mouraria'],
    bestTime: 'April to October',
    seats: 12,
    groupSize: 12,
  },
  {
    id: 'iceland',
    name: 'Northern Iceland',
    country: 'Iceland',
    region: 'Europe',
    image: '/destinations/iceland.webp',
    imageAlt: 'A wide waterfall pouring into a turquoise river under a grey sky',
    price: 2150,
    nights: 7,
    rating: 4.9,
    reviews: 204,
    summary: 'Waterfalls, geothermal baths and whale watching in Húsavík.',
    description:
      'Drive the Diamond Circle with a local guide, soak in the Mývatn Nature Baths and head out on a whale watching trip from Húsavík. Small group, maximum 10 travelers.',
    highlights: ['Goðafoss and Dettifoss', 'Mývatn Nature Baths', 'Whale watching'],
    bestTime: 'June to September',
    seats: 0,
    groupSize: 10,
  },
  {
    id: 'bali',
    name: 'Ubud',
    country: 'Indonesia',
    region: 'Asia',
    image: '/destinations/bali.webp',
    imageAlt: 'Green rice terraces stepping down a hillside between palm trees',
    price: 1120,
    nights: 9,
    rating: 4.6,
    reviews: 751,
    summary: 'Rice terraces, jungle villas and a cooking class with a Balinese family.',
    description:
      'Stay in a villa over the Ayung river, walk the Tegallalang terraces at dawn and cook with a family in their compound. The last two nights are on the coast in Sanur.',
    highlights: ['Tegallalang at dawn', 'Balinese cooking class', 'Two nights in Sanur'],
    bestTime: 'April to October',
    seats: 6,
    groupSize: 12,
  },
  {
    id: 'swiss-alps',
    name: 'Bernese Oberland',
    country: 'Switzerland',
    region: 'Europe',
    image: '/destinations/swiss-alps.webp',
    imageAlt: 'Snowy mountains above a still lake with a farmhouse on a hill',
    price: 2480,
    nights: 6,
    rating: 4.8,
    reviews: 318,
    summary: 'Lakeside villages, mountain trains and alpine hikes above Lake Thun.',
    description:
      'Base yourself in a lakeside chalet, ride the Jungfrau railway and hike between mountain huts. A Swiss Travel Pass covers every train, boat and cable car.',
    highlights: ['Jungfrau railway', 'Hut-to-hut hike', 'Swiss Travel Pass included'],
    bestTime: 'June to September',
    seats: 5,
    groupSize: 12,
  },
  {
    id: 'cape-town',
    name: 'Cape Town',
    country: 'South Africa',
    region: 'Africa',
    image: '/destinations/cape-town.webp',
    imageAlt: 'Table Mountain rising above the city and the Atlantic coastline',
    price: 1680,
    nights: 8,
    rating: 4.7,
    reviews: 296,
    summary: 'Table Mountain, Cape Point and wine country an hour away.',
    description:
      'Hike or ride up Table Mountain, drive the Chapman’s Peak road to Cape Point and spend two nights in Franschhoek wine country. Includes a visit to Boulders Beach penguins.',
    highlights: ['Table Mountain', 'Cape Point drive', 'Two nights in Franschhoek'],
    bestTime: 'November to March',
    seats: 9,
    groupSize: 12,
  },
];

export function findDestination(id: string | null | undefined): Destination | undefined {
  return DESTINATIONS.find((destination) => destination.id === id);
}
