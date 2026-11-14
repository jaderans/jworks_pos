/** The bonus mini sticker designs, numbered by theme (assets/mini-stickers has them full size). */
export interface MiniSticker {
  no: string;
  name: string;
  theme: string;
}

export const MINI_STICKERS: readonly MiniSticker[] = [
  { no: '01', name: 'Digital Pencil', theme: 'Creative and tech' },
  { no: '02', name: 'Laptop', theme: 'Creative and tech' },
  { no: '03', name: 'Headphones', theme: 'Creative and tech' },
  { no: '04', name: 'Gaming Headset', theme: 'Creative and tech' },
  { no: '05', name: 'Game Controller', theme: 'Creative and tech' },
  { no: '06', name: 'Ballpen', theme: 'Creative and tech' },
  { no: '07', name: 'Book', theme: 'Creative and tech' },
  { no: '08', name: 'Clipboard Checklist', theme: 'Creative and tech' },
  { no: '09', name: 'Calculator', theme: 'Creative and tech' },
  { no: '10', name: 'Megaphone', theme: 'Media and arts' },
  { no: '11', name: 'Newspaper', theme: 'Media and arts' },
  { no: '12', name: 'Clapperboard', theme: 'Media and arts' },
  { no: '13', name: 'Theater Masks', theme: 'Media and arts' },
  { no: '14', name: 'Microscope', theme: 'Science' },
  { no: '15', name: 'Test Tube', theme: 'Science' },
  { no: '16', name: 'Chalkboard E=mc2', theme: 'Science' },
  { no: '17', name: 'Rocket', theme: 'Science' },
  { no: '18', name: 'Stethoscope', theme: 'Health and medicine' },
  { no: '19', name: 'Caduceus', theme: 'Health and medicine' },
  { no: '20', name: 'Thermometer', theme: 'Health and medicine' },
  { no: '21', name: 'Face Mask', theme: 'Health and medicine' },
  { no: '22', name: 'Toothy Grin', theme: 'Dentistry' },
  { no: '23', name: 'Dentures', theme: 'Dentistry' },
  { no: '24', name: 'Sparkling Smile', theme: 'Dentistry' },
  { no: '25', name: 'Big Smile', theme: 'Dentistry' },
  { no: '26', name: 'Scales of Justice', theme: 'Law' },
  { no: '27', name: 'Gavel', theme: 'Law' },
  { no: '28', name: 'Basketball', theme: 'Sports' },
  { no: '29', name: 'Dumbbell', theme: 'Sports' },
  { no: '30', name: 'Running Shoes', theme: 'Sports' },
  { no: '31', name: 'High-top Sneaker', theme: 'Sports' },
  { no: '32', name: 'Flexing Arms', theme: 'Sports' },
  { no: '33', name: 'Sleeping Cat', theme: 'Animals and nature' },
  { no: '34', name: 'Whale', theme: 'Animals and nature' },
  { no: '35', name: 'Koi Fish', theme: 'Animals and nature' },
  { no: '36', name: 'Sardine', theme: 'Animals and nature' },
  { no: '37', name: 'Tulip', theme: 'Animals and nature' },
  { no: '38', name: 'Eyeglasses', theme: 'Everyday' },
  { no: '39', name: 'Safety Pin', theme: 'Everyday' },
  { no: '40', name: 'Eight Ball', theme: 'Everyday' },
  { no: '41', name: 'Ace of Hearts', theme: 'Everyday' },
  { no: '42', name: 'Grenade', theme: 'Everyday' },
  { no: '43', name: 'Money Stack', theme: 'Money' },
  { no: '44', name: 'Fist of Cash', theme: 'Money' },
  { no: '45', name: 'Eye', theme: 'Moods and memes' },
  { no: '46', name: 'Overthinking', theme: 'Moods and memes' },
  { no: '47', name: 'Scribble Thought', theme: 'Moods and memes' },
  { no: '48', name: 'TV Head', theme: 'Moods and memes' },
  { no: '49', name: 'Twisted Rope', theme: 'Moods and memes' },
];

/** "07 Book" */
export const miniLabel = (m: Pick<MiniSticker, 'no' | 'name'>): string => `${m.no} ${m.name}`;
