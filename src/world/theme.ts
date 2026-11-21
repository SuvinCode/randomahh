/** Arena looks. One is picked at random for each battle. */

export const BACKGROUND_STYLES = ['plain', 'gradient', 'stars', 'clouds', 'grid', 'waves'] as const;
export type BackgroundStyle = (typeof BACKGROUND_STYLES)[number];

export interface Palette {
  sky: string;
  ground: string;
  platform: string;
  accent: string;
  hazard: string;
}

export type ArenaLayout = 'classic' | 'towers' | 'steps';

export interface ArenaTheme {
  name: string;
  palette: Palette;
  backgroundStyle: BackgroundStyle;
  layout: ArenaLayout;
}

export const ARENAS: readonly ArenaTheme[] = [
  { name: 'Meadow Mayhem', backgroundStyle: 'clouds', layout: 'classic', palette: { sky: '#7cc6fe', ground: '#4f8a3c', platform: '#8a5a3b', accent: '#fff275', hazard: '#d7263d' } },
  { name: 'Neon Rooftops', backgroundStyle: 'grid', layout: 'towers', palette: { sky: '#120a2a', ground: '#2d2a4a', platform: '#5b4b8a', accent: '#3df2ff', hazard: '#ff3d81' } },
  { name: 'Moon Base', backgroundStyle: 'stars', layout: 'steps', palette: { sky: '#0d1026', ground: '#5c6170', platform: '#8b91a1', accent: '#ffd23f', hazard: '#ff5d3d' } },
  { name: 'Sunset Canyon', backgroundStyle: 'gradient', layout: 'classic', palette: { sky: '#f2a65a', ground: '#a0522d', platform: '#6b4226', accent: '#1fb5a8', hazard: '#3a0ca3' } },
  { name: 'Pirate Cove', backgroundStyle: 'waves', layout: 'steps', palette: { sky: '#0f3057', ground: '#c2a36b', platform: '#7a5230', accent: '#ffe66d', hazard: '#ff6b6b' } },
];
