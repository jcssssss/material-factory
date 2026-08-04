// answerConfig 持久化测试：损坏数据/缺字段回退默认，保存→加载往返。

import { describe, beforeEach, expect, it } from "vitest";
import {
  DEFAULT_ANSWER_CONFIG,
  loadAnswerConfig,
  saveAnswerConfig,
} from "../answerConfig";

describe("answerConfig", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("无数据时返回默认配置", () => {
    const cfg = loadAnswerConfig();
    expect(cfg.baseUrl).toBe("https://api.deepseek.com");
    expect(cfg.model).toBe("deepseek-chat");
    expect(cfg.customPrompt.length).toBeGreaterThan(100);
    // 输出文件夹默认空
    expect(cfg.outputDir).toBe("");
  });

  it("保存后能完整读回（含输出文件夹）", () => {
    const custom = {
      ...DEFAULT_ANSWER_CONFIG,
      baseUrl: "https://x.com/v1",
      model: "custom-model",
      outputDir: "/tmp/out",
    };
    saveAnswerConfig(custom);
    const loaded = loadAnswerConfig();
    expect(loaded.baseUrl).toBe("https://x.com/v1");
    expect(loaded.model).toBe("custom-model");
    expect(loaded.outputDir).toBe("/tmp/out");
  });

  it("损坏 JSON 回退默认配置", () => {
    localStorage.setItem("xhs-pic:answer-config", "{not-json");
    expect(loadAnswerConfig()).toEqual(DEFAULT_ANSWER_CONFIG);
  });

  it("缺字段的旧数据回退默认配置", () => {
    localStorage.setItem("xhs-pic:answer-config", JSON.stringify({ baseUrl: "https://x.com" }));
    expect(loadAnswerConfig()).toEqual(DEFAULT_ANSWER_CONFIG);
  });

  it("核心字段齐全但无 outputDir 的旧数据：outputDir 兜底为空串", () => {
    localStorage.setItem(
      "xhs-pic:answer-config",
      JSON.stringify({
        baseUrl: "https://x.com/v1",
        apiKey: "sk-test",
        model: "m1",
        customPrompt: "你好",
      })
    );
    const loaded = loadAnswerConfig();
    expect(loaded.baseUrl).toBe("https://x.com/v1");
    expect(loaded.outputDir).toBe("");
    expect(loaded.format).toBe("openai");
  });
});
