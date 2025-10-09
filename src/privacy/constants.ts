export const STORAGE_KEYS = {
  privacyProfile: 'gmh_privacy_profile',
  privacyBlacklist: 'gmh_privacy_blacklist',
  privacyWhitelist: 'gmh_privacy_whitelist',
} as const;

export const PRIVACY_PROFILES = {
  safe: {
    key: 'safe',
    label: 'SAFE (권장)',
    maskAddressHints: true,
    maskNarrativeSensitive: true,
  },
  standard: {
    key: 'standard',
    label: 'STANDARD',
    maskAddressHints: false,
    maskNarrativeSensitive: false,
  },
  research: {
    key: 'research',
    label: 'RESEARCH',
    maskAddressHints: false,
    maskNarrativeSensitive: false,
  },
} as const;

export type PrivacyProfileKey = keyof typeof PRIVACY_PROFILES;

export const DEFAULT_PRIVACY_PROFILE: PrivacyProfileKey = 'safe';
