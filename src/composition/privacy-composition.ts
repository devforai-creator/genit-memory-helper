import type { ErrorHandler, PrivacyPipelineApi } from '../types';
import type { PrivacyStore, PrivacyStoreConfig } from '../privacy/settings';

type CreatePrivacyStoreFn = typeof import('../privacy/settings').createPrivacyStore;
type CreatePrivacyPipelineFn = typeof import('../privacy/pipeline').createPrivacyPipeline;

type CollapseSpacesFn = (value: string) => string;
type PrivacyProfiles = Record<string, Record<string, unknown>>;
type PrivacyRedactTextFn = (
  value: string,
  profileKey: string,
  counts: Record<string, number> | undefined,
  config: PrivacyStoreConfig,
  profiles: PrivacyProfiles,
) => string;
type HasMinorSexualContextFn = (text: string) => boolean;
type GetPlayerNamesFn = () => string[];

interface ComposePrivacyEnv {
  console?:
    | Console
    | {
        log?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
      }
    | null;
  localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

interface ComposePrivacyOptions {
  createPrivacyStore: CreatePrivacyStoreFn;
  createPrivacyPipeline: CreatePrivacyPipelineFn;
  PRIVACY_PROFILES: PrivacyProfiles;
  DEFAULT_PRIVACY_PROFILE: string;
  collapseSpaces: CollapseSpacesFn;
  privacyRedactText: PrivacyRedactTextFn;
  hasMinorSexualContext: HasMinorSexualContextFn;
  getPlayerNames: GetPlayerNamesFn;
  ENV: ComposePrivacyEnv;
  errorHandler: ErrorHandler | null | undefined;
}

type PipelineRedactFn = (
  value: string,
  profileKey: string,
  counts: Record<string, number>,
  config?: unknown,
  profiles?: unknown,
) => string;

interface ComposePrivacyResult {
  privacyStore: PrivacyStore;
  privacyConfig: PrivacyStoreConfig;
  setPrivacyProfile: (profileKey: string) => string;
  setCustomList: PrivacyStore['setCustomList'];
  applyPrivacyPipeline: PrivacyPipelineApi['applyPrivacyPipeline'];
  boundRedactText: (
    text: string,
    profileKey: string,
    counts?: Record<string, number>,
  ) => string;
}

/**
 * Builds the privacy configuration pipeline and persistence store.
 *
 * @param options Dependency container.
 * @returns Privacy helpers bound to runtime configuration.
 */
export const composePrivacy = ({
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
}: ComposePrivacyOptions): ComposePrivacyResult => {
  const privacyStore = createPrivacyStore({
    storage: ENV.localStorage ?? null,
    errorHandler,
    collapseSpaces,
    defaultProfile: DEFAULT_PRIVACY_PROFILE,
    profiles: PRIVACY_PROFILES,
  });

  const privacyConfig = privacyStore.config;

  const setPrivacyProfile = (profileKey: string): string => {
    privacyStore.setProfile(profileKey);
    return privacyConfig.profile;
  };

  const setCustomList: PrivacyStore['setCustomList'] = (type, items) => {
    privacyStore.setCustomList(type, items);
    return privacyConfig;
  };

  const pipelineRedactText: PipelineRedactFn = (
    text,
    profileKey,
    counts,
    _config,
    _profiles,
  ) => privacyRedactText(text, profileKey, counts, privacyConfig, PRIVACY_PROFILES);

  const boundRedactText = (
    text: string,
    profileKey: string,
    counts?: Record<string, number>,
  ): string =>
    privacyRedactText(text, profileKey, counts as Record<string, number>, privacyConfig, PRIVACY_PROFILES);

  const { applyPrivacyPipeline } = createPrivacyPipeline({
    profiles: PRIVACY_PROFILES,
    getConfig: () => privacyConfig,
    redactText: pipelineRedactText,
    hasMinorSexualContext,
    getPlayerNames,
    logger: ENV.console ?? null,
    storage: ENV.localStorage ?? null,
  });

  return {
    privacyStore,
    privacyConfig,
    setPrivacyProfile,
    setCustomList,
    applyPrivacyPipeline,
    boundRedactText,
  };
};
