function cloneSession(session) {
  const clonedTurns = Array.isArray(session?.turns)
    ? session.turns.map((turn) => {
        const clone = { ...turn };
        if (Array.isArray(turn.__gmhEntries)) {
          Object.defineProperty(clone, '__gmhEntries', {
            value: turn.__gmhEntries.slice(),
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }
        if (Array.isArray(turn.__gmhSourceBlocks)) {
          Object.defineProperty(clone, '__gmhSourceBlocks', {
            value: turn.__gmhSourceBlocks.slice(),
            enumerable: false,
            writable: true,
            configurable: true,
          });
        }
        return clone;
      })
    : [];
  return {
    meta: { ...(session?.meta || {}) },
    turns: clonedTurns,
    warnings: Array.isArray(session?.warnings) ? [...session.warnings] : [],
    source: session?.source,
  };
}

function collectSessionStats(session) {
  if (!session) return { userMessages: 0, llmMessages: 0, totalMessages: 0, warnings: 0 };
  const userMessages = session.turns?.filter((turn) => turn.channel === 'user')?.length || 0;
  const llmMessages = session.turns?.filter((turn) => turn.channel === 'llm')?.length || 0;
  const totalMessages = session.turns?.length || 0;
  const warnings = session.warnings?.length || 0;
  return { userMessages, llmMessages, totalMessages, warnings };
}

/**
 * Wires the share workflow with grouped dependencies returned from index.
 *
 * @param {object} options - Dependency container.
 * @param {Function} options.createShareWorkflow - Share workflow factory.
 * @param {Function} options.captureStructuredSnapshot - Structured snapshot capture helper.
 * @param {Function} options.normalizeTranscript - Transcript normaliser.
 * @param {Function} options.buildSession - Session builder.
 * @param {object} options.exportRange - Export range controller.
 * @param {Function} options.projectStructuredMessages - Structured message projector.
 * @param {Function} options.applyPrivacyPipeline - Privacy pipeline executor.
 * @param {object} options.privacyConfig - Active privacy configuration reference.
 * @param {object} options.privacyProfiles - Supported privacy profiles.
 * @param {Function} options.formatRedactionCounts - Formatter for redaction metrics.
 * @param {Function} options.setPanelStatus - Panel status setter.
 * @param {Function} options.toMarkdownExport - Classic markdown exporter.
 * @param {Function} options.toJSONExport - Classic JSON exporter.
 * @param {Function} options.toTXTExport - Classic TXT exporter.
 * @param {Function} options.toStructuredMarkdown - Structured markdown exporter.
 * @param {Function} options.toStructuredJSON - Structured JSON exporter.
 * @param {Function} options.toStructuredTXT - Structured TXT exporter.
 * @param {Function} options.buildExportBundle - Bundle builder.
 * @param {Function} options.buildExportManifest - Manifest builder.
 * @param {Function} options.triggerDownload - Download helper.
 * @param {object} options.clipboard - Clipboard helpers.
 * @param {object} options.stateApi - State manager API.
 * @param {object} options.stateEnum - State enum reference.
 * @param {Function} options.confirmPrivacyGate - Privacy confirmation helper.
 * @param {Function} options.getEntryOrigin - Entry origin accessor.
 * @param {object} options.logger - Logger implementation.
 * @returns {object} Share workflow API with helper statistics.
 */
export function composeShareWorkflow({
  createShareWorkflow,
  captureStructuredSnapshot,
  normalizeTranscript,
  buildSession,
  exportRange,
  projectStructuredMessages,
  applyPrivacyPipeline,
  privacyConfig,
  privacyProfiles,
  formatRedactionCounts,
  setPanelStatus,
  toMarkdownExport,
  toJSONExport,
  toTXTExport,
  toStructuredMarkdown,
  toStructuredJSON,
  toStructuredTXT,
  buildExportBundle,
  buildExportManifest,
  triggerDownload,
  clipboard,
  stateApi,
  stateEnum,
  confirmPrivacyGate,
  getEntryOrigin,
  logger,
}) {
  const shareApi = createShareWorkflow({
    captureStructuredSnapshot,
    normalizeTranscript,
    buildSession,
    exportRange,
    projectStructuredMessages,
    cloneSession,
    applyPrivacyPipeline,
    privacyConfig,
    privacyProfiles,
    formatRedactionCounts,
    setPanelStatus,
    toMarkdownExport,
    toJSONExport,
    toTXTExport,
    toStructuredMarkdown,
    toStructuredJSON,
    toStructuredTXT,
    buildExportBundle,
    buildExportManifest,
    triggerDownload,
    clipboard,
    stateApi,
    stateEnum,
    confirmPrivacyGate,
    getEntryOrigin,
    collectSessionStats,
    logger,
  });

  return {
    ...shareApi,
    collectSessionStats,
  };
}
