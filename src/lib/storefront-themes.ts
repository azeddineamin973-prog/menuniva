/**
 * Storefront theme presets. Each preset defines the six colour roles of the guest menu.
 * Restaurants store four colours (primary, accent, background, text) plus the preset key; the
 * secondary and surface colours come from the preset, or are derived for custom colours.
 */
export type ThemeColors = { primary: string; secondary: string; background: string; surface: string; text: string; accent: string };
export type ThemePreset = { key: string; label: string; description: string; pattern?: boolean } & ThemeColors;

export const THEME_PRESETS = [
  { key: 'classic', label: 'Classic', description: 'Neutral and timeless', primary: '#2B2B2B', secondary: '#4A4A4A', background: '#FFFFFF', surface: '#FFFFFF', text: '#1A1A1A', accent: '#C0392B' },
  { key: 'moroccan', label: 'Moroccan', description: 'Deep green, gold, zellige pattern', pattern: true, primary: '#1F5C4A', secondary: '#2E7A63', background: '#FBF7EE', surface: '#FFFFFF', text: '#1E2420', accent: '#B8975A' },
  { key: 'minimal', label: 'Minimal', description: 'Graphite on soft grey', primary: '#171A1D', secondary: '#3B3F44', background: '#FAFAFA', surface: '#FFFFFF', text: '#171A1D', accent: '#6B7280' },
  { key: 'bistro', label: 'Bistro', description: 'Wine red and warm cream', primary: '#7A2E1F', secondary: '#9C4A33', background: '#FFF8F0', surface: '#FFFFFF', text: '#2A1A14', accent: '#D4A64A' },
  { key: 'fresh', label: 'Fresh', description: 'Teal and citrus, light and modern', primary: '#0F766E', secondary: '#115E59', background: '#F3FAF7', surface: '#FFFFFF', text: '#12201C', accent: '#F59E0B' },
  { key: 'terracotta', label: 'Terracotta', description: 'Clay orange and olive', primary: '#B4532A', secondary: '#8A3E1F', background: '#FBF5EF', surface: '#FFFFFF', text: '#2B1D16', accent: '#2F6B4F' },
  { key: 'midnight', label: 'Midnight', description: 'Dark with gold, for evening venues', primary: '#E8C46A', secondary: '#2A2F36', background: '#0F1115', surface: '#181B20', text: '#F2F0EA', accent: '#E8C46A' },
] as const satisfies readonly ThemePreset[];

export const THEME_KEYS = [...THEME_PRESETS.map((p) => p.key), 'custom'] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export function presetByKey(key: string | null | undefined): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.key === key);
}
