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
};

export default CONFIG;
