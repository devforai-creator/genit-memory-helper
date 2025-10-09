export interface ConfigLimits {
  PRIVACY_LIST_MAX: number;
  PRIVACY_ITEM_MAX: number;
  PREVIEW_TURN_LIMIT: number;
}

export interface AutoLoaderProfile {
  cycleDelayMs: number;
  settleTimeoutMs: number;
  maxStableRounds: number;
  guardLimit: number;
}

export type AutoLoaderProfileKey = 'default' | 'stability' | 'fast';

export interface AutoLoaderConfig {
  METER_INTERVAL_MS: number;
  PROFILES: Record<AutoLoaderProfileKey, AutoLoaderProfile>;
}

export interface ConfigTiming {
  BOOT_DELAY_MS: number;
  AUTO_LOADER: AutoLoaderConfig;
}

export interface Config {
  LIMITS: ConfigLimits;
  TIMING: ConfigTiming;
}

export const CONFIG = {
  LIMITS: {
    PRIVACY_LIST_MAX: 1000,
    PRIVACY_ITEM_MAX: 200,
    PREVIEW_TURN_LIMIT: 5,
  },
  TIMING: {
    BOOT_DELAY_MS: 1200,
    AUTO_LOADER: {
      METER_INTERVAL_MS: 1500,
      PROFILES: {
        default: {
          cycleDelayMs: 700,
          settleTimeoutMs: 2000,
          maxStableRounds: 3,
          guardLimit: 60,
        },
        stability: {
          cycleDelayMs: 1200,
          settleTimeoutMs: 2600,
          maxStableRounds: 5,
          guardLimit: 140,
        },
        fast: {
          cycleDelayMs: 350,
          settleTimeoutMs: 900,
          maxStableRounds: 2,
          guardLimit: 40,
        },
      },
    },
  },
} satisfies Config;

export default CONFIG;
