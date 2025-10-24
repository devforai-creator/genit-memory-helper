export interface PanelStateApi {
  setState(state: string, payload?: unknown): boolean;
  getState?(): unknown;
  subscribe?(listener: (state: string, meta?: Record<string, unknown>) => void): () => void;
  reset?(): void;
}

export interface PanelStateManager extends PanelStateApi {
  current: string;
  previous: string | null;
  payload: unknown;
  reset(): void;
}

export interface ExperimentalFeatureFlag {
  readonly enabled: boolean;
  enable(): boolean;
  disable(): boolean;
}

export interface ExperimentalNamespace {
  [key: string]: ExperimentalFeatureFlag;
  MemoryIndex: ExperimentalFeatureFlag;
}

export interface ExperimentalNamespaceOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  console?: Pick<Console, 'log' | 'warn'> | null;
}

export interface GMHNamespace {
  VERSION: string;
  Util: Record<string, unknown>;
  Privacy: Record<string, unknown>;
  Export: Record<string, unknown>;
  UI: Record<string, unknown>;
  Core: Record<string, unknown>;
  Adapters: Record<string, unknown>;
  Settings: Record<string, unknown>;
  Flags?: Record<string, unknown>;
  Experimental?: ExperimentalNamespace;
}

export interface AdapterSelectors {
  [key: string]: string[] | undefined;
}

export interface AdapterMetadata {
  [key: string]: unknown;
}

export interface AdapterConfig {
  selectors?: AdapterSelectors;
  metadata?: AdapterMetadata;
}

export interface AdapterRegistry {
  register(name: string, config?: AdapterConfig): void;
  get(name: string): AdapterConfig;
  list(): string[];
}

export interface StateManagerOptions {
  console?: Console | { warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void } | null;
  debug?: (...args: unknown[]) => void;
}

export interface ErrorHandler {
  LEVELS: Record<string, string>;
  handle(error: unknown, context?: string, level?: string): string;
  getErrorLog?(): ErrorLogEntry[];
  clearErrorLog?(): boolean;
}

export interface ErrorLogEntry {
  timestamp: string;
  context: string;
  level: string;
  message: string;
  stack: string | null;
}

export interface ErrorHandlerOptions {
  console?: Console | { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void } | null;
  alert?: (message: string) => void;
  localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  state?: PanelStateApi;
}

export interface PanelSettingsLayout {
  anchor?: 'left' | 'right';
  offset?: number;
  bottom?: number;
  width?: number | null;
  height?: number | null;
  [key: string]: unknown;
}

export interface PanelSettingsBehavior {
  autoHideEnabled?: boolean;
  autoHideDelayMs?: number;
  collapseOnOutside?: boolean;
  collapseOnFocus?: boolean;
  allowDrag?: boolean;
  allowResize?: boolean;
  [key: string]: unknown;
}

export interface PanelSettingsValue {
  layout?: PanelSettingsLayout;
  behavior?: PanelSettingsBehavior;
  [key: string]: unknown;
}

export interface PanelSettingsController {
  STORAGE_KEY?: string;
  defaults?: {
    layout?: PanelSettingsLayout;
    behavior?: PanelSettingsBehavior;
  };
  get(): PanelSettingsValue;
  update(value: Partial<PanelSettingsValue>): PanelSettingsValue;
  reset(): PanelSettingsValue;
  onChange(listener: (next: PanelSettingsValue) => void): () => void;
}

export interface PanelVisibilityController {
  bind(panel: Element | null | undefined, options?: { modern?: boolean }): void;
  open(options?: { focus?: boolean; persist?: boolean }): boolean;
  close(reason?: string): boolean;
  toggle(): boolean;
  isCollapsed(): boolean;
  onStatusUpdate?(update?: { tone?: string | null }): void;
}

export interface PanelStatusManager {
  setStatus(message: string, tone?: string | null): void;
  attachStatusElement(element: HTMLElement | null): void;
}

export interface MessageIndexerSummary {
  totalMessages: number;
  userMessages: number;
  llmMessages?: number;
  containerPresent?: boolean;
  timestamp?: number;
  [key: string]: unknown;
}

export interface MessageIndexer {
  start(): void;
  stop(): void;
  refresh(options?: { immediate?: boolean }): MessageIndexerSummary;
  getSummary(): MessageIndexerSummary;
  lookupOrdinalByIndex(index: number): number | null;
  lookupOrdinalByMessageId(messageId: string): number | null;
  subscribe(listener: (summary: MessageIndexerSummary) => void): () => void;
}

export interface MessageIndexerOptions {
  console?: Console | { warn?: (...args: unknown[]) => void; error?: (...args: unknown[]) => void } | null;
  document?: Document | null;
  MutationObserver?: typeof MutationObserver;
  requestAnimationFrame?: typeof requestAnimationFrame;
  exportRange?: ExportRangeController | null;
  getActiveAdapter?: () => {
    findContainer?(doc: Document): Element | null;
    listMessageBlocks?(doc: Document | Element): Iterable<Element> | Element[] | NodeListOf<Element> | null;
    detectRole?(block: Element): string;
  } | null;
  getEntryOrigin?: () => Array<number | null>;
}

export interface TurnBookmarkEntry {
  key: string;
  index: number;
  ordinal: number | null;
  messageId: string | null;
  timestamp: number;
}

export interface TurnBookmarks {
  record(index: number, ordinal?: number | null, messageId?: string | null, axis?: string): TurnBookmarkEntry | null;
  clear(): void;
  remove(key: string): void;
  get(): TurnBookmarkEntry | null;
  latest(): TurnBookmarkEntry | null;
  pick(key: string): TurnBookmarkEntry | null;
  list(): TurnBookmarkEntry[];
  subscribe(listener: (entries: TurnBookmarkEntry[]) => void): () => void;
}

export interface TurnBookmarksOptions {
  console?: Console | { warn?: (...args: unknown[]) => void } | null;
}

export interface BookmarkListenerOptions {
  document?: Document | null;
  ElementClass?: typeof Element;
  messageIndexer?: MessageIndexer | null;
  turnBookmarks?: TurnBookmarks | null;
  console?: Console | { warn?: (...args: unknown[]) => void } | null;
}

export interface BookmarkListener {
  start(): void;
  stop(): void;
  isActive(): boolean;
}

export interface ExportRangeTotals {
  message: number;
  user: number;
  llm: number;
  entry: number;
}

export interface ExportRangeInfo {
  active?: boolean;
  start?: number | null;
  end?: number | null;
  count?: number | null;
  total?: number | null;
  messageTotal?: number | null;
  userTotal?: number | null;
  llmTotal?: number | null;
  startIndex?: number | null;
  endIndex?: number | null;
  [key: string]: unknown;
}

export interface ExportRangeSelection {
  indices: number[];
  ordinals?: Array<number | null>;
  info?: ExportRangeInfo | null;
  turns?: TranscriptTurn[];
  rangeDetails?: {
    startIndex: number;
    endIndex: number;
    messageStartIndex: number | null;
    messageEndIndex: number | null;
  } | null;
}

export interface ExportRangeController {
  getRange(): { start: number | null; end: number | null };
  getTotals(): ExportRangeTotals;
  describe(total?: number): ExportRangeInfo;
  apply(turns: TranscriptTurn[], options?: ExportRangeApplyOptions): ExportRangeSelection;
  setStart(value?: number | null): ExportRangeSnapshot;
  setEnd(value?: number | null): ExportRangeSnapshot;
  setRange(start?: number | null, end?: number | null): ExportRangeSnapshot;
  clear(): ExportRangeSnapshot;
  setTotals(input?: ExportRangeTotalsInput): ExportRangeSnapshot;
  subscribe(listener: (snapshot: ExportRangeSnapshot) => void): () => void;
  snapshot(): ExportRangeSnapshot;
}

export interface ExportRangeSnapshot {
  range: { start: number | null; end: number | null };
  totals: ExportRangeTotals;
  bounds: ExportRangeInfo;
}

export interface ExportRangeApplyOptions {
  includeIndices?: number[];
  traceRange?: boolean;
}

export interface ExportRangeTotalsInput extends Partial<ExportRangeTotals> {
  all?: number;
  player?: number;
}

export interface ExportRangeOptions {
  console?: Console | { warn?: (...args: unknown[]) => void; table?: (...args: unknown[]) => void } | null;
  window?: (Window & typeof globalThis) & { GMH_DEBUG_RANGE?: unknown };
  localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export interface TranscriptTurn {
  channel: string;
  role?: string;
  speaker?: string;
  text: string;
  __gmhEntries?: unknown[];
  __gmhSourceBlocks?: number[];
  [key: string]: unknown;
}

export interface TranscriptSession {
  turns: TranscriptTurn[];
  meta?: Record<string, unknown>;
  warnings: unknown[];
  source?: unknown;
  player_names?: string[];
  [key: string]: unknown;
}

export interface TranscriptMetaHints {
  header: RegExpExecArray | null;
  codes: string[];
  titles: string[];
}

export interface TranscriptMeta {
  date?: string;
  mode?: string;
  place?: string;
  title?: string;
  actors?: string[];
  player?: string;
  turn_count?: number;
  message_count?: number;
  channel_counts?: { user: number; llm: number };
  [key: string]: unknown;
}

export interface TranscriptParseResult {
  turns: TranscriptTurn[];
  warnings: string[];
  metaHints: TranscriptMetaHints;
}

export type EntryOriginProvider = () => Array<number | null>;

export interface AutoLoaderOptions {
  stateApi: PanelStateApi;
  stateEnum: Record<string, string> & {
    SCANNING?: string;
    DONE?: string;
    ERROR?: string;
    IDLE?: string;
  };
  errorHandler: ErrorHandler;
  messageIndexer: MessageIndexer;
  exportRange?: ExportRangeController;
  setPanelStatus?(message: string, tone?: string): void;
  getActiveAdapter(): {
    findContainer?(doc: Document): Element | null;
    listMessageBlocks?(doc: Document | Element):
      | Iterable<Element>
      | Element[]
      | NodeListOf<Element>
      | null;
  } | null;
  sleep(ms: number): Promise<void>;
  isScrollable(element: Element | null | undefined): boolean;
  documentRef?: Document | null;
  windowRef?: (Window & typeof globalThis) | null;
  normalizeTranscript(raw: string): string;
  buildSession(raw: string): TranscriptSession;
  readTranscriptText(options?: { force?: boolean }): string;
  logger?: Console | { warn?: (...args: unknown[]) => void } | null;
}

export interface AutoLoaderStats {
  session: TranscriptSession | null;
  userMessages: number;
  llmMessages: number;
  totalMessages: number;
  error?: unknown;
}

export interface AutoLoaderStartOptions {
  profile?: string;
}

export interface AutoLoaderController {
  lastMode: 'all' | 'turns' | null;
  lastTarget: number | null;
  lastProfile: string | null;
  start(mode: 'all' | 'turns', target?: number | null, options?: AutoLoaderStartOptions): Promise<AutoLoaderStats | null>;
  startCurrent(profileName?: string): Promise<AutoLoaderStats | null>;
  setProfile(profileName: string): void;
  stop(): void;
}

export interface AutoLoaderExports {
  autoLoader: AutoLoaderController;
  autoState: {
    running: boolean;
    container: Element | null;
    meterTimer: ReturnType<typeof setInterval> | null;
  };
  autoProfiles: Record<string, Record<string, unknown>>;
  getProfile(): string;
  subscribeProfileChange(listener: (profile: string) => void): () => void;
  startTurnMeter(meter: HTMLElement): void;
  collectTurnStats(options?: { force?: boolean }): AutoLoaderStats;
}

export interface StructuredSnapshotMessagePart {
  speaker?: string | null;
  role?: string | null;
  flavor?: string | null;
  type?: string | null;
  text?: string | null;
  language?: string | null;
  lines?: string[];
  legacyLines?: string[];
  items?: string[];
  alt?: string | null;
  title?: string | null;
  level?: number | null;
  ordered?: boolean;
  src?: string | null;
  legacyFormat?: string | null;
  [key: string]: unknown;
}

export interface StructuredSnapshotMessage {
  id?: string | null;
  index?: number | null;
  ordinal?: number | null;
  userOrdinal?: number | null;
  speaker?: string | null;
  role?: string | null;
  channel?: string | null;
  parts?: StructuredSnapshotMessagePart[];
  legacyLines?: string[];
  [key: string]: unknown;
}

export interface StructuredSnapshot {
  messages: StructuredSnapshotMessage[];
  legacyLines: string[];
  entryOrigin: Array<number | null>;
  errors: unknown[];
  generatedAt: number;
  [key: string]: unknown;
}

export interface StructuredCollectorMeta {
  node?: Element | null;
}

export interface StructuredCollector {
  defaults?: { playerName?: string };
  push(part: StructuredSnapshotMessagePart | null | undefined, meta?: StructuredCollectorMeta): void;
  list(): StructuredSnapshotMessagePart[];
}

export interface StructuredSelectionRangeInfo {
  active: boolean;
  start: number | null;
  end: number | null;
  messageStartIndex: number | null;
  messageEndIndex: number | null;
  count?: number;
  total?: number;
  messageTotal?: number;
  [key: string]: unknown;
}

export interface StructuredSelectionResult {
  messages: StructuredSnapshotMessage[];
  sourceTotal: number;
  range: StructuredSelectionRangeInfo;
  [key: string]: unknown;
}

export interface MemoryBlockInit {
  id: string;
  sessionUrl: string;
  raw: string;
  messages: StructuredSnapshotMessage[];
  ordinalRange: [number, number];
  timestamp: number;
  embedding?: ArrayBuffer | ArrayBufferView | null;
  meta?: Record<string, unknown>;
}

export interface MemoryBlockRecord extends Omit<MemoryBlockInit, 'embedding'> {
  embedding: ArrayBuffer | null;
  messageCount: number;
  startOrdinal: number;
  endOrdinal: number;
}

export interface BlockStorageStats {
  totalBlocks: number;
  totalMessages: number;
  sessions: number;
}

export interface BlockStorageController {
  save(block: MemoryBlockInit): Promise<void>;
  get(id: string): Promise<MemoryBlockRecord | null>;
  getBySession(sessionUrl: string): Promise<MemoryBlockRecord[]>;
  delete(id: string): Promise<boolean>;
  clear(sessionUrl?: string): Promise<number>;
  getStats(): Promise<BlockStorageStats>;
  close(): void;
}

export interface BlockStorageOptions {
  dbName?: string;
  storeName?: string;
  version?: number;
  indexedDB?: IDBFactory | null;
  console?: Pick<Console, 'warn' | 'log' | 'error'> | null;
}

export interface StripLegacySpeechOptions {
  playerMark?: string;
}

export interface ClipboardHelper {
  set(value: string, options?: { type?: string; mimetype?: string; [key: string]: unknown }): void;
}

export interface ClassicJSONExportOptions {
  playerNames?: string[];
}

export interface ClassicTXTExportOptions {
  turns?: TranscriptTurn[];
  includeMeta?: boolean;
}

export interface ClassicMarkdownExportOptions extends ClassicTXTExportOptions {
  heading?: string;
}

export interface StructuredMarkdownOptions {
  messages?: StructuredSnapshotMessage[];
  session?: TranscriptSession;
  profile?: string;
  rangeInfo?: ExportRangeInfo | StructuredSelectionRangeInfo | null;
  playerNames?: string[];
  playerMark?: string;
}

export interface StructuredJSONOptions {
  session?: TranscriptSession;
  structuredSelection?: StructuredSelectionResult | null;
  structuredSnapshot?: StructuredSnapshot | null;
  profile?: string;
  playerNames?: string[];
  rangeInfo?: ExportRangeInfo | StructuredSelectionRangeInfo | null;
  normalizedRaw?: string;
  playerMark?: string;
}

export interface StructuredTXTOptions {
  messages?: StructuredSnapshotMessage[];
  session?: TranscriptSession;
  profile?: string;
  rangeInfo?: ExportRangeInfo | StructuredSelectionRangeInfo | null;
  playerNames?: string[];
  playerMark?: string;
}

export interface GuidePromptStatusMessages {
  summaryCopied?: string;
  resummaryCopied?: string;
  [key: string]: unknown;
}

export interface GuidePromptOptions {
  clipboard: ClipboardHelper;
  setPanelStatus?: (message: string, tone?: string) => void;
  statusMessages?: GuidePromptStatusMessages;
}

export interface SnapshotAdapter {
  findContainer?(doc: Document): Element | null;
  listMessageBlocks?(root: Document | Element): Iterable<Element> | Element[] | NodeListOf<Element> | null;
  collectStructuredMessage?(block: Element): StructuredSnapshotMessage | null;
  emitTranscriptLines?(block: Element, pushLine: (line: string) => void, collector?: StructuredCollector | null): void;
  dumpSelectors?(): AdapterSelectors | null | undefined;
  resetInfoRegistry?(): void;
}

export interface AdapterMatchLocation {
  hostname?: string;
  [key: string]: unknown;
}

export interface GenitAdapterOptions {
  registry?: AdapterRegistry | null;
  playerMark?: string;
  getPlayerNames?: (() => string[] | null | undefined) | null;
  isPrologueBlock?: (block: Element | null | undefined) => boolean;
  errorHandler?:
    | ErrorHandler
    | {
        handle?: (error: unknown, context?: string, level?: string) => string | void;
        LEVELS?: Record<string, string>;
      }
    | null;
}

export interface GenitAdapter extends SnapshotAdapter {
  id: string;
  label: string;
  match(loc: Location | AdapterMatchLocation, doc?: Document): boolean;
  findContainer(doc?: Document): Element | null;
  listMessageBlocks(root?: Document | Element): Iterable<Element> | Element[] | NodeListOf<Element> | null;
  emitTranscriptLines(block: Element, pushLine: (line: string) => void, collector?: StructuredCollector | null): void;
  collectStructuredMessage(block: Element): StructuredSnapshotMessage | null;
  detectRole(block: Element | null | undefined): string;
  guessPlayerNames(root?: Document): string[];
  getPanelAnchor(doc?: Document): Element | null;
  dumpSelectors(): AdapterSelectors;
  resetInfoRegistry(): void;
  setPlayerNameAccessor(accessor: () => string[] | null | undefined): void;
}

export interface SnapshotFeatureOptions {
  getActiveAdapter: () => SnapshotAdapter | null | undefined;
  triggerDownload: (blob: Blob, filename: string) => void;
  setPanelStatus: (message: string, tone?: string) => void;
  errorHandler:
    | ErrorHandler
    | {
        handle?: (error: unknown, context?: string, level?: string) => string;
        LEVELS?: Record<string, string>;
      };
  documentRef?: Document | null;
  locationRef?: Location | null;
}

export interface SnapshotCaptureOptions {
  force?: boolean;
}

export interface StructuredSnapshotReaderOptions {
  getActiveAdapter: () => SnapshotAdapter | null | undefined;
  setEntryOriginProvider?: (provider: () => Array<number | null>) => void;
  documentRef?: Document | null;
}

export interface ExportBundleOptions {
  structuredSelection?: StructuredSelectionResult | null;
  structuredSnapshot?: StructuredSnapshot | null;
  profile?: string;
  playerNames?: string[];
  rangeInfo?: ExportRangeInfo | null;
  playerMark?: string;
  [key: string]: unknown;
}

export interface ExportBundleResult {
  content: string;
  filename: string;
  mime: string;
  stamp: string;
  format: string;
}

export interface ExportManifestOptions {
  profile?: string;
  counts?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  overallStats?: Record<string, unknown>;
  format?: string;
  warnings?: unknown[];
  source?: unknown;
  range?: ExportRangeInfo | null | undefined | Record<string, unknown> | unknown;
  version?: string;
}

export interface ExportManifest {
  tool: string;
  version?: string;
  generated_at: string;
  profile?: string;
  counts?: Record<string, unknown>;
  stats?: Record<string, unknown>;
  overall_stats?: Record<string, unknown>;
  range?: ExportRangeInfo | null | undefined | Record<string, unknown> | unknown;
  format?: string;
  warnings?: unknown[];
  source?: unknown;
}

export interface ShareWorkflowOptions {
  captureStructuredSnapshot(options?: { force?: boolean }): StructuredSnapshot;
  normalizeTranscript(raw: string): string;
  buildSession(raw: string): TranscriptSession;
  exportRange?: ExportRangeController;
  projectStructuredMessages(
    structured: StructuredSnapshot | null | undefined,
    info?: ExportRangeInfo | null,
  ): StructuredSelectionResult;
  cloneSession(session: TranscriptSession): TranscriptSession;
  applyPrivacyPipeline(session: TranscriptSession, raw: string, profile: string, snapshot?: StructuredSnapshot | null): PrivacyPipelineResult;
  privacyConfig: { profile: string; [key: string]: unknown };
  privacyProfiles: Record<string, { label?: string; [key: string]: unknown }>;
  formatRedactionCounts(counts: Record<string, number>): string;
  setPanelStatus?(message: string, tone?: string): void;
  toMarkdownExport(session: TranscriptSession, options?: ClassicMarkdownExportOptions): string;
  toJSONExport(session: TranscriptSession, options?: ClassicJSONExportOptions): string;
  toTXTExport(session: TranscriptSession, options?: ClassicTXTExportOptions): string;
  toStructuredMarkdown(options?: StructuredMarkdownOptions): string;
  toStructuredJSON(options?: StructuredJSONOptions): string;
  toStructuredTXT(options?: StructuredTXTOptions): string;
  buildExportBundle(
    session: TranscriptSession,
    rawSelection: string,
    format: string,
    stamp: string,
    options?: ExportBundleOptions,
  ): ExportBundleResult;
  buildExportManifest(options: ExportManifestOptions): ExportManifest;
  triggerDownload(blob: Blob, filename: string): void;
  clipboard: { set(value: string, options?: Record<string, unknown>): void };
  stateApi: PanelStateApi;
  stateEnum: Record<string, string> & { PREVIEW?: string; EXPORTING?: string; REDACTING?: string; DONE?: string; ERROR?: string; IDLE?: string };
  confirmPrivacyGate(options: Record<string, unknown>): Promise<boolean>;
  getEntryOrigin(): Array<number | null>;
  collectSessionStats(session: TranscriptSession): { userMessages: number; llmMessages: number; [key: string]: unknown };
  alert?(message: string): void;
  logger?: Console | { log?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void };
}

export interface PreparedShareResult {
  privacy: PrivacyPipelineResult;
  stats: { userMessages: number; llmMessages: number; [key: string]: unknown };
  overallStats: { userMessages: number; llmMessages: number; [key: string]: unknown } | null;
  selection: ExportRangeSelection | null;
  rangeInfo: ExportRangeInfo | null | undefined;
  exportSession: TranscriptSession;
  structuredSelection: StructuredSelectionResult | null;
}

export interface ShareWorkflowApi {
  parseAll(): { session: TranscriptSession; raw: string; snapshot: StructuredSnapshot };
  prepareShare(options?: { confirmLabel?: string; cancelStatusMessage?: string; blockedStatusMessage?: string }): Promise<PreparedShareResult | null>;
  performExport(prepared: PreparedShareResult | null, format: string): Promise<boolean>;
  copyRecent(prepareShareFn: ShareWorkflowApi['prepareShare']): Promise<void>;
  copyAll(prepareShareFn: ShareWorkflowApi['prepareShare']): Promise<void>;
  reparse(): void;
}

export interface PrivacyPipelineDependencies {
  profiles?: Record<string, Record<string, unknown>>;
  getConfig?: () => Record<string, unknown> | undefined;
  redactText(value: string, profile: string, counts: Record<string, number>, config?: unknown, profiles?: unknown): string;
  hasMinorSexualContext?: (text: string) => boolean;
  getPlayerNames?: () => string[];
  logger?: Console | { log?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void } | null;
  storage?: { getItem(key: string): string | null } | null;
}

export interface PrivacyPipelineResult {
  profile: string;
  sanitizedSession: TranscriptSession;
  sanitizedRaw: string;
  structured: StructuredSnapshot | null;
  playerNames: string[];
  counts: Record<string, number>;
  totalRedactions: number;
  blocked: boolean;
}

export interface PrivacyPipelineApi {
  applyPrivacyPipeline(
    session: TranscriptSession,
    rawText: string,
    profileKey: string,
    structuredSnapshot?: StructuredSnapshot | null,
  ): PrivacyPipelineResult;
}

export interface ModalAction {
  id?: string;
  label: string;
  value?: unknown;
  type?: string;
  variant?: string;
  attrs?: Record<string, string>;
  disabled?: boolean;
  onSelect?(event: Event): boolean | void;
}

export interface ModalOpenOptions {
  title?: string;
  description?: string;
  size?: 'small' | 'medium' | 'large';
  bodyClass?: string;
  content?: Node | string | null;
  actions?: ModalAction[];
  dismissible?: boolean;
  initialFocus?: string;
}

export interface ModalController {
  open(options?: ModalOpenOptions): Promise<unknown>;
  close(result?: unknown): void;
  isOpen(): boolean;
}

export interface PanelVisibilityOptions {
  panelSettings: PanelSettingsController;
  stateEnum: Record<string, string> & { IDLE?: string };
  stateApi: PanelStateApi;
  modal?: ModalController | null;
  documentRef?: Document | null;
  windowRef?: (Window & typeof globalThis) | null;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  logger?: Console | { warn?: (...args: unknown[]) => void } | null;
}

export interface StateViewBindings {
  progressFill?: HTMLElement | null;
  progressLabel?: HTMLElement | null;
}

export interface StateViewOptions {
  stateApi: PanelStateApi;
  statusManager: PanelStatusManager;
  stateEnum: Record<string, string>;
}

export interface PanelInteractionsOptions {
  panelVisibility: PanelVisibilityController;
  setPanelStatus?: (message: string, tone?: string | null) => void;
  setPrivacyProfile(profileKey: string): void;
  getPrivacyProfile?(): string | null | undefined;
  privacyProfiles?: Record<string, { label?: string; [key: string]: unknown }>;
  configurePrivacyLists?(): Promise<void> | void;
  openPanelSettings?(): void;
  ensureAutoLoadControlsModern?(panel: Element): void;
  ensureAutoLoadControlsLegacy?(panel: Element): void;
  mountStatusActionsModern?(panel: Element): void;
  mountStatusActionsLegacy?(panel: Element): void;
  bindRangeControls(panel: Element): void;
  bindShortcuts(panel: Element, options?: { modern?: boolean }): void;
  bindGuideControls?(panel: Element): void;
  prepareShare: ShareWorkflowApi['prepareShare'];
  performExport: ShareWorkflowApi['performExport'];
  copyRecentShare: ShareWorkflowApi['copyRecent'];
  copyAllShare: ShareWorkflowApi['copyAll'];
  autoLoader?: AutoLoaderController | null;
  autoState?: AutoLoaderExports['autoState'] | null;
  stateApi: PanelStateApi;
  stateEnum: Record<string, string>;
  alert?: (message: string) => void;
  logger?: Console | { warn?: (...args: unknown[]) => void } | null;
}

export interface PanelShortcutsOptions {
  windowRef: Window & typeof globalThis;
  panelVisibility: PanelVisibilityController;
  autoLoader: AutoLoaderController;
  autoState: AutoLoaderExports['autoState'];
  configurePrivacyLists: () => Promise<void> | void;
  modal?: ModalController | null;
}
