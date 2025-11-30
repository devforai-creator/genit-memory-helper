import { describe, it, expect, vi } from 'vitest';
import { createShareWorkflow } from '../../src/features/share';

describe('Share Workflow', () => {
  const createMockDependencies = () => {
    const mockSession = {
      turns: [
        { role: 'player', speaker: '플레이어', text: '안녕', channel: 'user' },
        { role: 'npc', speaker: 'NPC', text: '반갑습니다', channel: 'llm' },
      ],
      source: 'genit.ai',
      warnings: [],
      meta: {},
    };

    const mockSnapshot = {
      messages: [],
      legacyLines: ['플레이어: 안녕', 'NPC: 반갑습니다'],
      meta: {},
    };

    const mockPrivacyResult = {
      profile: 'standard',
      counts: { EMAIL: 0, PHONE: 0 },
      sanitizedSession: { ...mockSession },
      sanitizedRaw: '플레이어: 안녕\nNPC: 반갑습니다',
      structured: mockSnapshot,
      blocked: false,
      playerNames: ['플레이어'],
    };

    return {
      captureStructuredSnapshot: vi.fn().mockReturnValue(mockSnapshot),
      normalizeTranscript: vi.fn((raw) => raw),
      buildSession: vi.fn().mockReturnValue(mockSession),
      exportRange: {
        setTotals: vi.fn(),
        getRange: vi.fn().mockReturnValue({ start: null, end: null }),
        setRange: vi.fn(),
        apply: vi.fn().mockReturnValue({
          indices: [0, 1],
          ordinals: [1, 2],
          turns: mockSession.turns,
          rangeDetails: null,
          info: { active: false, start: 1, end: 2, count: 2, total: 2 },
        }),
        describe: vi.fn().mockReturnValue({
          active: false,
          start: 1,
          end: 2,
          count: 2,
          total: 2,
        }),
      },
      projectStructuredMessages: vi.fn().mockReturnValue({
        messages: [],
        rangeInfo: {},
      }),
      cloneSession: vi.fn((session) => JSON.parse(JSON.stringify(session))),
      applyPrivacyPipeline: vi.fn().mockReturnValue(mockPrivacyResult),
      privacyConfig: { profile: 'standard' },
      privacyProfiles: {
        standard: { label: '표준' },
        strict: { label: '엄격' },
      },
      formatRedactionCounts: vi.fn((counts) =>
        Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(', ') || '없음',
      ),
      setPanelStatus: vi.fn(),
      toMarkdownExport: vi.fn(() => '# Export'),
      toJSONExport: vi.fn((session) => JSON.stringify(session)),
      toTXTExport: vi.fn(() => 'Text export'),
      toStructuredMarkdown: vi.fn(() => '# Structured'),
      toStructuredJSON: vi.fn((snapshot) => JSON.stringify(snapshot)),
      toStructuredTXT: vi.fn(() => 'Structured text'),
      buildExportBundle: vi.fn().mockReturnValue({
        content: 'export content',
        filename: 'export.json',
        mime: 'application/json',
      }),
      buildExportManifest: vi.fn().mockReturnValue({
        version: '1.0',
        profile: 'standard',
      }),
      triggerDownload: vi.fn(),
      clipboard: {
        set: vi.fn(),
      },
      stateApi: {
        setState: vi.fn(),
        getState: vi.fn(),
      },
      stateEnum: {
        IDLE: 'IDLE',
        REDACTING: 'REDACTING',
        PREVIEW: 'PREVIEW',
        EXPORTING: 'EXPORTING',
        DONE: 'DONE',
        ERROR: 'ERROR',
      },
      confirmPrivacyGate: vi.fn().mockResolvedValue(true),
      getEntryOrigin: vi.fn().mockReturnValue([]),
      collectSessionStats: vi.fn().mockReturnValue({
        userMessages: 1,
        llmMessages: 1,
        totalMessages: 2,
      }),
      alert: vi.fn(),
      logger: null,
    };
  };

  describe('createShareWorkflow factory', () => {
    it('creates workflow with valid dependencies', () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      expect(workflow).toBeDefined();
      expect(typeof workflow.parseAll).toBe('function');
      expect(typeof workflow.prepareShare).toBe('function');
      expect(typeof workflow.performExport).toBe('function');
    });

    it('throws if required dependency is missing', () => {
      const deps = createMockDependencies();
      delete (deps as any).captureStructuredSnapshot;

      expect(() => {
        createShareWorkflow(deps as any);
      }).toThrow();
    });

    it('throws if exportRange.setTotals is missing', () => {
      const deps = createMockDependencies();
      deps.exportRange = { getRange: vi.fn() } as any;

      expect(() => {
        createShareWorkflow(deps as any);
      }).toThrow();
    });
  });

  describe('parseAll()', () => {
    it('captures snapshot and builds session', () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      const result = workflow.parseAll();

      expect(deps.captureStructuredSnapshot).toHaveBeenCalledWith({ force: true });
      expect(deps.normalizeTranscript).toHaveBeenCalled();
      expect(deps.buildSession).toHaveBeenCalled();
      expect(result.session).toBeDefined();
      expect(result.raw).toBeDefined();
      expect(result.snapshot).toBeDefined();
    });

    it('updates export range totals', () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      workflow.parseAll();

      expect(deps.exportRange.setTotals).toHaveBeenCalledWith({
        message: 2,
        user: 1,
        llm: 1,
        entry: 2,
      });
    });

    it('throws if no turns found', () => {
      const deps = createMockDependencies();
      deps.buildSession.mockReturnValue({ turns: [], warnings: [] });
      const workflow = createShareWorkflow(deps as any);

      expect(() => workflow.parseAll()).toThrow('대화 메시지를 찾을 수 없습니다');
    });
  });

  describe('prepareShare()', () => {
    it('applies privacy pipeline and returns prepared result', async () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      const result = await workflow.prepareShare();

      expect(deps.applyPrivacyPipeline).toHaveBeenCalled();
      expect(deps.confirmPrivacyGate).toHaveBeenCalled();
      expect(result).not.toBeNull();
      expect(result!.privacy).toBeDefined();
      expect(result!.stats).toBeDefined();
    });

    it('returns null when privacy gate is cancelled', async () => {
      const deps = createMockDependencies();
      deps.confirmPrivacyGate.mockResolvedValue(false);
      const workflow = createShareWorkflow(deps as any);

      const result = await workflow.prepareShare();

      expect(result).toBeNull();
      expect(deps.stateApi.setState).toHaveBeenCalledWith('IDLE', expect.any(Object));
    });

    it('returns null and alerts when content is blocked', async () => {
      const deps = createMockDependencies();
      deps.applyPrivacyPipeline.mockReturnValue({
        ...deps.applyPrivacyPipeline(),
        blocked: true,
      });
      const workflow = createShareWorkflow(deps as any);

      const result = await workflow.prepareShare();

      expect(result).toBeNull();
      expect(deps.alert).toHaveBeenCalled();
      expect(deps.stateApi.setState).toHaveBeenCalledWith('ERROR', expect.any(Object));
    });

    it('updates state during workflow', async () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      await workflow.prepareShare();

      // Should have set REDACTING state
      expect(deps.stateApi.setState).toHaveBeenCalledWith(
        'REDACTING',
        expect.objectContaining({
          label: '민감정보 마스킹 중',
        }),
      );
    });
  });

  describe('performExport()', () => {
    it('triggers download with correct format', async () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      const prepared = await workflow.prepareShare();
      const result = await workflow.performExport(prepared, 'json');

      expect(result).toBe(true);
      expect(deps.buildExportBundle).toHaveBeenCalled();
      expect(deps.triggerDownload).toHaveBeenCalledTimes(2); // export + manifest
    });

    it('returns false when prepared is null', async () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      const result = await workflow.performExport(null, 'json');

      expect(result).toBe(false);
    });

    it('downloads manifest alongside export', async () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      const prepared = await workflow.prepareShare();
      await workflow.performExport(prepared, 'json');

      expect(deps.buildExportManifest).toHaveBeenCalled();
      // triggerDownload called twice: once for export, once for manifest
      expect(deps.triggerDownload).toHaveBeenCalledTimes(2);
    });

    it('sets DONE state on success', async () => {
      const deps = createMockDependencies();
      const workflow = createShareWorkflow(deps as any);

      const prepared = await workflow.prepareShare();
      await workflow.performExport(prepared, 'json');

      expect(deps.stateApi.setState).toHaveBeenCalledWith(
        'DONE',
        expect.objectContaining({
          label: '내보내기 완료',
        }),
      );
    });

    it('handles export error gracefully', async () => {
      const deps = createMockDependencies();
      deps.buildExportBundle.mockImplementation(() => {
        throw new Error('Export failed');
      });
      const workflow = createShareWorkflow(deps as any);

      const prepared = await workflow.prepareShare();
      const result = await workflow.performExport(prepared, 'json');

      expect(result).toBe(false);
      expect(deps.alert).toHaveBeenCalledWith(expect.stringContaining('Export failed'));
      expect(deps.stateApi.setState).toHaveBeenCalledWith('ERROR', expect.any(Object));
    });

    it('falls back to classic format on structured export failure', async () => {
      const deps = createMockDependencies();
      let callCount = 0;
      deps.buildExportBundle.mockImplementation((_, __, format) => {
        callCount++;
        if (callCount === 1 && format === 'structured-json') {
          throw new Error('Structured export failed');
        }
        return {
          content: 'fallback content',
          filename: 'export.json',
          mime: 'application/json',
        };
      });
      const workflow = createShareWorkflow(deps as any);

      const prepared = await workflow.prepareShare();
      const result = await workflow.performExport(prepared, 'structured-json');

      expect(result).toBe(true);
      // Should have called buildExportBundle twice (first structured, then classic)
      expect(deps.buildExportBundle).toHaveBeenCalledTimes(2);
    });
  });
});
