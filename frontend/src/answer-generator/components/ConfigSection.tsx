// 答案生成器左侧配置区：试卷文件 / 模型配置 / Prompt 设置 / 生成操作。

import { useState } from "react";
import { FilePickerButton } from "../../components/common/FilePickerButton";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { useAnswerStore } from "../store/useAnswerStore";
import { testApiConnection, listAvailableModels } from "../services/answerIpc";
import { protocolForModel } from "../lib/modelInfo";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderOpen,
  KeyRound,
  List,
  Loader2,
  Play,
  Plug,
  RefreshCcw,
  Server,
  Cpu,
  X,
} from "lucide-react";

const CARD_CLASS =
  "rounded-xl border border-workspace-border/60 bg-workspace-surface p-4 shadow-card";
const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-workspace-muted";

// 常用提供商快捷预设：一键填充接口地址 + 模型名 + 协议（API Key 需用户自填）。
const PROVIDER_PRESETS: {
  label: string;
  baseUrl: string;
  model: string;
  format: "openai" | "anthropic";
}[] = [
  {
    label: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    model: "deepseek-v4-flash",
    format: "openai",
  },
  {
    label: "DeepSeek 官方",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    format: "openai",
  },
];

export function ConfigSection() {
  const config = useAnswerStore((s) => s.config);
  const files = useAnswerStore((s) => s.files);
  const status = useAnswerStore((s) => s.status);
  const error = useAnswerStore((s) => s.error);
  const setConfig = useAnswerStore((s) => s.setConfig);
  const resetPrompt = useAnswerStore((s) => s.resetPrompt);
  const setFiles = useAnswerStore((s) => s.setFiles);
  const setOutputDir = useAnswerStore((s) => s.setOutputDir);
  const resetOutputDir = useAnswerStore((s) => s.resetOutputDir);
  const startGeneration = useAnswerStore((s) => s.startGeneration);
  const cancelGeneration = useAnswerStore((s) => s.cancelGeneration);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  // 从 /models 拉取的可用模型列表（下拉选择）；null 表示未加载，用自由输入
  const [modelList, setModelList] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [customModelInput, setCustomModelInput] = useState(false);

  const busy = status === "running";
  const configReady =
    config.baseUrl.trim() !== "" && config.apiKey.trim() !== "" && config.model.trim() !== "";

  // 测试连接：用当前配置发一次最小请求，立即验证 key / 地址 / 模型名。
  async function handleTestConnection() {
    if (busy || !configReady) return;
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await testApiConnection(
        config.baseUrl,
        config.apiKey,
        config.model,
        config.format
      );
      setTestResult({ ok: true, message: msg });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ ok: false, message: msg });
    } finally {
      setTesting(false);
    }
  }

  function applyPreset(preset: (typeof PROVIDER_PRESETS)[number]) {
    setConfig({
      baseUrl: preset.baseUrl,
      model: preset.model,
      format: preset.format,
    });
    setTestResult(null);
    setModelList(null);
    setCustomModelInput(false);
  }

  // 从提供商 /models 端点拉取可用模型，供下拉选择。
  async function handleLoadModels() {
    if (busy || !config.baseUrl.trim()) return;
    setLoadingModels(true);
    setModelListError(null);
    try {
      const list = await listAvailableModels(config.baseUrl, config.apiKey);
      setModelList(list);
    } catch (err) {
      setModelListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModels(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
      {/* 试卷文件 */}
      <section className={CARD_CLASS}>
        <div className="mb-2 flex items-center gap-2">
          <FileText className="h-4 w-4 text-workspace-accent" />
          <h3 className="text-sm font-semibold text-workspace-fg">试卷文件</h3>
        </div>
        <FilePickerButton
          mode="multiPdf"
          label={files.length ? "重新选择" : "选择试卷 PDF"}
          onPick={(paths) => setFiles(paths)}
          disabled={busy}
        />
        {files.length > 0 ? (
          <div className="mt-2 space-y-1 text-xs text-workspace-muted">
            <p className="text-workspace-fg-secondary">已选 {files.length} 份 PDF</p>
            {files.slice(0, 3).map((f) => (
              <p key={f.path} className="truncate" title={f.path}>
                · {f.name}
              </p>
            ))}
            {files.length > 3 && <p>… 等共 {files.length} 份</p>}
          </div>
        ) : (
          <p className="mt-2 text-xs text-workspace-muted/70">
            支持一次选择多份 PDF（带文本层，扫描版自动 OCR）
          </p>
        )}
      </section>

      {/* 输出文件夹 */}
      <section className={CARD_CLASS}>
        <div className="mb-2 flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-workspace-accent" />
          <h3 className="text-sm font-semibold text-workspace-fg">输出文件夹</h3>
        </div>
        {config.outputDir ? (
          <div className="flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs text-workspace-fg-secondary">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-workspace-muted" />
            <span className="truncate" title={config.outputDir}>
              {config.outputDir}
            </span>
          </div>
        ) : (
          <p className="mb-1 text-xs text-workspace-muted/70">
            未设置时默认保存到第一个文件的所在文件夹
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <FilePickerButton
            mode="outputDir"
            label="选择文件夹"
            onPick={(paths) => {
              if (paths[0]) setOutputDir(paths[0]);
            }}
            disabled={busy}
          />
          {config.outputDir && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-workspace-muted hover:text-workspace-fg"
              onClick={resetOutputDir}
              disabled={busy}
            >
              恢复默认
            </Button>
          )}
        </div>
      </section>

      {/* 模型配置 */}
      <section className={CARD_CLASS}>
        <div className="mb-2 flex items-center gap-2">
          <Server className="h-4 w-4 text-workspace-accent" />
          <h3 className="text-sm font-semibold text-workspace-fg">模型配置</h3>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-workspace-muted/70">快捷预设：</span>
          {PROVIDER_PRESETS.map((p) => (
            <Button
              key={p.label}
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => applyPreset(p)}
              disabled={busy}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="mb-3 flex items-center gap-1.5">
          <span className="text-[11px] text-workspace-muted/70">协议：</span>
          <Button
            variant={config.format === "openai" ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setConfig({ format: "openai" })}
            disabled={busy}
          >
            OpenAI 兼容
          </Button>
          <Button
            variant={config.format === "anthropic" ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => setConfig({ format: "anthropic" })}
            disabled={busy}
          >
            Anthropic 兼容
          </Button>
        </div>
        <div className="space-y-3">
          <div>
            <label className={LABEL_CLASS}>接口地址（BaseURL）</label>
            <Input
              value={config.baseUrl}
              onChange={(e) => setConfig({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com"
              disabled={busy}
            />
          </div>
          <div>
            <label className={LABEL_CLASS}>API Key</label>
            <div className="relative">
              <Input
                type="password"
                value={config.apiKey}
                onChange={(e) => setConfig({ apiKey: e.target.value })}
                placeholder="sk-..."
                disabled={busy}
                className="pr-9"
              />
              <KeyRound className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-workspace-muted/50" />
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-workspace-muted">模型名称</label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[11px] text-workspace-muted hover:text-workspace-fg"
                onClick={() => void handleLoadModels()}
                disabled={busy || loadingModels || !config.baseUrl.trim()}
                title="从提供商的 /models 接口拉取可用模型列表（OpenCode Go 支持）"
              >
                {loadingModels ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <List className="h-3.5 w-3.5" />
                )}
                获取模型列表
              </Button>
            </div>
            {modelList && !customModelInput ? (
              <Select
                value={config.model}
                options={modelList}
                placeholder="选择模型"
                disabled={busy}
                onChange={(v) => {
                  // 选模型时按 OpenCode Go 官方端点表自动切换协议
                  setConfig({ model: v, format: protocolForModel(v) });
                }}
                onManualInput={() => setCustomModelInput(true)}
              />
            ) : (
              <div className="relative">
                <Input
                  value={config.model}
                  onChange={(e) => setConfig({ model: e.target.value })}
                  placeholder="deepseek-chat"
                  disabled={busy}
                  className="pr-9"
                />
                <Cpu className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-workspace-muted/50" />
              </div>
            )}
            {modelList && customModelInput && (
              <button
                type="button"
                className="mt-1 text-[11px] text-workspace-accent hover:underline"
                onClick={() => setCustomModelInput(false)}
              >
                用列表选择模型
              </button>
            )}
            {modelListError && (
              <p className="mt-1 text-[11px] text-destructive">{modelListError}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleTestConnection()}
              disabled={busy || !configReady || testing}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plug className="h-4 w-4" />
              )}
              测试连接
            </Button>
            {testResult && (
              <span
                className={
                  "flex min-w-0 items-center gap-1.5 text-[11px] " +
                  (testResult.ok ? "text-emerald-600" : "text-destructive")
                }
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="truncate" title={testResult.message}>
                  {testResult.ok
                    ? testResult.message
                    : testResult.message.replace(
                        /^请求失败\(HTTP (\d+)\):\s*/,
                        "HTTP $1 · "
                      )}
                </span>
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Prompt 设置 */}
      <section className={CARD_CLASS}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCcw className="h-4 w-4 text-workspace-accent" />
            <h3 className="text-sm font-semibold text-workspace-fg">Prompt 设置</h3>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-workspace-muted hover:text-workspace-fg"
            onClick={resetPrompt}
            disabled={busy}
          >
            恢复默认
          </Button>
        </div>
        <Textarea
          value={config.customPrompt}
          onChange={(e) => setConfig({ customPrompt: e.target.value })}
          rows={8}
          className="min-h-[180px] resize-y text-xs leading-relaxed"
          placeholder="填写自定义 Prompt；留空将使用默认 Prompt"
          disabled={busy}
        />
        <p className="mt-1.5 text-[11px] text-workspace-muted/70">
          留空或清空时生成将回退到内置的默认 Prompt
        </p>
      </section>

      {/* 生成操作 */}
      <section className={CARD_CLASS}>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => void startGeneration()}
            disabled={busy || files.length === 0 || !configReady}
            className="flex-1 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-700 hover:to-indigo-600"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {busy
              ? "生成中…"
              : files.length > 0
                ? `开始生成（${files.length}）`
                : "开始生成"}
          </Button>
          {busy && (
            <Button variant="destructive" onClick={cancelGeneration} title="取消生成">
              <X className="h-4 w-4" />
              取消
            </Button>
          )}
        </div>
        {files.length === 0 && !busy && (
          <p className="mt-2 text-xs text-workspace-muted/70">请先选择试卷 PDF</p>
        )}
        {files.length > 0 && !configReady && !busy && (
          <p className="mt-2 text-xs text-workspace-muted/70">
            请先补全模型配置（接口地址 / API Key / 模型名称）
          </p>
        )}
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-all whitespace-pre-wrap">{error}</span>
          </div>
        )}
      </section>
    </div>
  );
}
