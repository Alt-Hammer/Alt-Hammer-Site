export interface Alliance {
  id: string;
  label: string;
  accentColor: string;
}

export const ALLIANCES: Alliance[] = [
  { id: 'imperium',  label: 'The Imperium',       accentColor: '#c9a84c' },
  { id: 'chaos',     label: 'Forces of Chaos',     accentColor: '#8b2020' },
  { id: 'aeldari',   label: 'The Aeldari',         accentColor: '#3a7bd5' },
  { id: 'xenos',     label: 'Xenos Species',       accentColor: '#2e8b57' },
  { id: 'devourer',  label: 'The Great Devourer',  accentColor: '#7b3fa0' },
];
