// 水印处理逻辑单元测试。
// Mock Tauri invoke 调用，验证编排流程。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { processBatch } from "../watermarkProcessor";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => mockInvoke(cmd, args),
}));

describe("watermarkProcessor", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("单文件检测到水印并移除", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "detect_watermark_info") {
        return Promise.resolve({
          hasWatermark: true,
          hasHeader: false,
          hasFooter: false,
          regions: [
            {
              pageNumber: 1,
              text: "CONFIDENTIAL",
              type: "watermark",
              bbox: [0.3, 0.4, 0.7, 0.5],
            },
          ],
          pageCount: 1,
          summary: "检测到水印（共 1 处）",
        });
      }
      if (cmd === "remove_watermarks") {
        return Promise.resolve({
          outputPath: "/output/test_clean.pdf",
          removedHeader: false,
          removedFooter: false,
          removedWatermark: true,
          removedCount: 1,
        });
      }
      return null;
    });

    const onProgress = vi.fn();
    await processBatch(
      [
        {
          id: "1",
          name: "test.pdf",
          path: "/input/test.pdf",
          extension: "pdf",
          groupName: "默认文件夹",
          status: "pending",
          report: null,
          removal: null,
          errorMessage: null,
        },
      ],
      "/output",
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls[0][1]).toBe("detecting");
    expect(onProgress.mock.calls[1][1]).toBe("removing");
    expect(onProgress.mock.calls[2][1]).toBe("done");
  });

  it("单文件无水印时跳过移除", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "detect_watermark_info") {
        return Promise.resolve({
          hasWatermark: false,
          hasHeader: false,
          hasFooter: false,
          regions: [],
          pageCount: 1,
          summary: "无水印/页眉/页脚",
        });
      }
      return null;
    });

    const onProgress = vi.fn();
    await processBatch(
      [
        {
          id: "2",
          name: "clean.pdf",
          path: "/input/clean.pdf",
          extension: "pdf",
          groupName: "默认文件夹",
          status: "pending",
          report: null,
          removal: null,
          errorMessage: null,
        },
      ],
      "/output",
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][1]).toBe("detecting");
    expect(onProgress.mock.calls[1][1]).toBe("no_watermark");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("检测报错时标记为失败", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("file not found"));

    const onProgress = vi.fn();
    await processBatch(
      [
        {
          id: "3",
          name: "missing.pdf",
          path: "/input/missing.pdf",
          extension: "pdf",
          groupName: "默认文件夹",
          status: "pending",
          report: null,
          removal: null,
          errorMessage: null,
        },
      ],
      "/output",
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledWith("3", "failed", null, null, "file not found");
  });

  it("批量处理中单文件失败不中断后续", async () => {
    let callCount = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "detect_watermark_info") {
        callCount += 1;
        if (callCount === 1) {
          return Promise.reject(new Error("read error"));
        }
        return Promise.resolve({
          hasWatermark: false,
          hasHeader: false,
          hasFooter: false,
          regions: [],
          pageCount: 1,
          summary: "无水印/页眉/页脚",
        });
      }
      return null;
    });

    const onProgress = vi.fn();
    await processBatch(
      [
        { id: "a", name: "bad.pdf", path: "/input/bad.pdf", extension: "pdf", groupName: "默认文件夹", status: "pending", report: null, removal: null, errorMessage: null },
        { id: "b", name: "good.pdf", path: "/input/good.pdf", extension: "pdf", groupName: "默认文件夹", status: "pending", report: null, removal: null, errorMessage: null },
      ],
      "/output",
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledWith("a", "failed", null, null, "read error");
    expect(onProgress).toHaveBeenCalledWith("b", "no_watermark", expect.any(Object));
  });
});
