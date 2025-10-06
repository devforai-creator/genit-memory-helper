/**
 * Builds the privacy configuration pipeline and persistence store.
 *
 * @param {object} options - Dependency container.
 * @param {Function} options.createPrivacyStore - Factory for privacy store.
 * @param {Function} options.createPrivacyPipeline - Factory for redaction pipeline.
 * @param {object} options.PRIVACY_PROFILES - Available privacy profile definitions.
 * @param {string} options.DEFAULT_PRIVACY_PROFILE - Default profile key.
 * @param {Function} options.collapseSpaces - Text normaliser.
 * @param {Function} options.privacyRedactText - Redaction function.
 * @param {Function} options.hasMinorSexualContext - Minor detection helper.
 * @param {Function} options.getPlayerNames - Player name accessor.
 * @param {object} options.ENV - Environment shims (console/storage).
 * @param {object} options.errorHandler - Error handler instance.
 * @returns {object} Privacy helpers bound to runtime configuration.
 */
export function composePrivacy({
  createPrivacyStore,
  createPrivacyPipeline,
  PRIVACY_PROFILES,
  DEFAULT_PRIVACY_PROFILE,
  collapseSpaces,
  privacyRedactText,
  hasMinorSexualContext,
  getPlayerNames,
  ENV,
  errorHandler,
}) {
  const privacyStore = createPrivacyStore({
    storage: ENV.localStorage,
    errorHandler,
    collapseSpaces,
    defaultProfile: DEFAULT_PRIVACY_PROFILE,
    profiles: PRIVACY_PROFILES,
  });

  const privacyConfig = privacyStore.config;

  const setPrivacyProfile = (profileKey) => {
    privacyStore.setProfile(profileKey);
    return privacyConfig.profile;
  };

  const setCustomList = (type, items) => {
    privacyStore.setCustomList(type, items);
    return privacyConfig;
  };

  const boundRedactText = (text, profileKey, counts) =>
    privacyRedactText(text, profileKey, counts, privacyConfig, PRIVACY_PROFILES);

  const { applyPrivacyPipeline } = createPrivacyPipeline({
    profiles: PRIVACY_PROFILES,
    getConfig: () => privacyConfig,
    redactText: boundRedactText,
    hasMinorSexualContext,
    getPlayerNames,
    logger: ENV.console,
    storage: ENV.localStorage,
  });

  return {
    privacyStore,
    privacyConfig,
    setPrivacyProfile,
    setCustomList,
    applyPrivacyPipeline,
    boundRedactText,
  };
}
