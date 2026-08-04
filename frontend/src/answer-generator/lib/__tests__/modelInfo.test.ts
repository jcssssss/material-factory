// protocolForModel 单元测试：OpenCode Go 的 Anthropic 兼容模型推断。

import { describe, expect, it } from "vitest";
import { protocolForModel } from "../modelInfo";

describe("protocolForModel", () => {
  it("Anthropic 兼容模型：Qwen3 与 MiniMax", () => {
    expect(protocolForModel("qwen3.8-max")).toBe("anthropic");
    expect(protocolForModel("qwen3.6-plus")).toBe("anthropic");
    expect(protocolForModel("minimax-m3")).toBe("anthropic");
    expect(protocolForModel("minimax-m2.7")).toBe("anthropic");
  });

  it("OpenAI 兼容模型", () => {
    expect(protocolForModel("deepseek-v4-flash")).toBe("openai");
    expect(protocolForModel("deepseek-v4-pro")).toBe("openai");
    expect(protocolForModel("grok-4.5")).toBe("openai");
    expect(protocolForModel("glm-5.2")).toBe("openai");
    expect(protocolForModel("kimi-k3")).toBe("openai");
    expect(protocolForModel("hy3")).toBe("openai");
  });
});
