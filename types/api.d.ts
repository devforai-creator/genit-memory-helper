export interface PanelStateApi {
  setState(state: string, payload?: unknown): void;
  getState?(): unknown;
}

export interface ErrorHandler {
  handle(error: unknown, context?: string, level?: string): void;
  LEVELS?: Record<string, string>;
}

export interface MessageIndexerSummary {
  totalMessages: number;
  userMessages: number;
  llmMessages: number;
  timestamp?: number;
  [key: string]: unknown;
}

export interface MessageIndexer {
  refresh(options?: { immediate?: boolean }): MessageIndexerSummary | null | undefined;
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
  ordinals?: number[];
  info?: ExportRangeInfo | null;
}

export interface ExportRangeController {
  clear?(): void;
  setTotals?(totals: ExportRangeTotals): void;
  getTotals?(): ExportRangeTotals | null | undefined;
  setRange?(start?: number | null, end?: number | null): void;
  getRange?(): { start?: number | null; end?: number | null } | null | undefined;
  apply?(turns: TranscriptTurn[]): ExportRangeSelection | null | undefined;
  describe?(total?: number): ExportRangeInfo | null | undefined;
  getRangeLabel?(): string;
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
    listMessageBlocks?(doc: Document): Element[] | NodeListOf<Element> | null;
  } | null;
  sleep(ms: number): Promise<void>;
  isScrollable(element: Element): boolean;
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
  speaker?: string;
  text?: string;
  lines?: string[];
  legacyLines?: string[];
  items?: string[];
  alt?: string;
  title?: string;
  [key: string]: unknown;
}

export interface StructuredSnapshotMessage {
  speaker?: string;
  parts?: StructuredSnapshotMessagePart[];
  legacyLines?: string[];
  [key: string]: unknown;
}

export interface StructuredSnapshot {
  messages: StructuredSnapshotMessage[];
  legacyLines: string[];
  entryOrigin: unknown[];
  errors: unknown[];
  generatedAt: number;
  [key: string]: unknown;
}

export interface ShareWorkflowOptions {
  captureStructuredSnapshot(options?: { force?: boolean }): StructuredSnapshot;
  normalizeTranscript(raw: string): string;
  buildSession(raw: string): TranscriptSession;
  exportRange?: ExportRangeController;
  projectStructuredMessages(structured: StructuredSnapshot, info?: ExportRangeInfo | null): unknown;
  cloneSession(session: TranscriptSession): TranscriptSession;
  applyPrivacyPipeline(session: TranscriptSession, raw: string, profile: string, snapshot?: StructuredSnapshot | null): PrivacyPipelineResult;
  privacyConfig: { profile: string; [key: string]: unknown };
  privacyProfiles: Record<string, { label?: string; [key: string]: unknown }>;
  formatRedactionCounts(counts: Record<string, number>): string;
  setPanelStatus?(message: string, tone?: string): void;
  toMarkdownExport(session: TranscriptSession, options?: Record<string, unknown>): string;
  toJSONExport(session: TranscriptSession, options?: Record<string, unknown>): string;
  toTXTExport(session: TranscriptSession, options?: Record<string, unknown>): string;
  toStructuredMarkdown(session: TranscriptSession, options?: Record<string, unknown>): string;
  toStructuredJSON(session: TranscriptSession, options?: Record<string, unknown>): string;
  toStructuredTXT(session: TranscriptSession, options?: Record<string, unknown>): string;
  buildExportBundle(
    session: TranscriptSession,
    rawSelection: string,
    format: string,
    stamp: string,
    options?: Record<string, unknown>,
  ): { content: string; filename: string; mime: string };
  buildExportManifest(options: Record<string, unknown>): Record<string, unknown>;
  triggerDownload(blob: Blob, filename: string): void;
  clipboard: { set(value: string, options?: Record<string, unknown>): void };
  stateApi: PanelStateApi;
  stateEnum: Record<string, string> & { PREVIEW?: string; EXPORTING?: string; REDACTING?: string; DONE?: string; ERROR?: string; IDLE?: string };
  confirmPrivacyGate(options: Record<string, unknown>): Promise<boolean>;
  getEntryOrigin(): unknown[];
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
  structuredSelection: unknown;
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
  size?: 'small' | 'large';
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
