// Only the ordinary 50-row payload was observed. Other views keep their
// existing 20-row contract; do not extrapolate missing fields to those views.
export const ALL_PROFILE = 'pc-all50-v1';
export const FILTER_PROFILE = 'pc-filter20-v1';
export const LEGACY_PROFILE = 'pc-legacy20-v1';
export const profileFor = scope => scope === 'all' ? ALL_PROFILE : FILTER_PROFILE;
export const pageSizeFor = scope => scope === 'all' ? 50 : 20;
export const knownProfile = value => [ALL_PROFILE, FILTER_PROFILE, LEGACY_PROFILE].includes(value);
