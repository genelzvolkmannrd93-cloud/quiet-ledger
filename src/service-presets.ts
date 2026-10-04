import type { Category, SubscriptionInput } from './domain.ts';

// Local suggestions only: no remote icons, tracking requests or assumed prices.
export const servicePresets: readonly { name: string; category: Category; mark: string; color: string }[] = [
  { name: 'Spotify', category: 'entertainment', mark: 'S', color: '#276344' },
  { name: 'Netflix', category: 'entertainment', mark: 'N', color: '#a9363b' },
  { name: 'YouTube Premium', category: 'entertainment', mark: 'Y', color: '#ab4536' },
  { name: 'Яндекс Плюс', category: 'entertainment', mark: 'Я', color: '#7850a0' },
  { name: 'ChatGPT', category: 'software', mark: 'G', color: '#39756b' },
  { name: 'iCloud+', category: 'software', mark: 'i', color: '#386da4' },
  { name: 'Google One', category: 'software', mark: 'G', color: '#977137' },
  { name: 'Xbox Game Pass', category: 'games', mark: 'X', color: '#47734a' },
];

export function applyServicePreset(form: SubscriptionInput, preset: (typeof servicePresets)[number]): SubscriptionInput {
  return { ...form, name: preset.name, category: preset.category };
}

export function serviceBadge(name: string) {
  return servicePresets.find((preset) => preset.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
}
