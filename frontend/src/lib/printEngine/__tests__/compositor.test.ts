import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const MINI_JPG = new Uint8Array([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10,
  0x4a, 0x46, 0x49, 0x46, 0x00,
  0x01, 0x01,
  0x00,
  0x00, 0x01,
  0x00, 0x01,
  0x00, 0x00,
  0xff, 0xd9,
]);

// 模拟 Worker：init → ready，compose → result(MINI_JPG buffer)。
function makeMockWorker(): Worker {
  const handlers: Record<string, (e: MessageEvent) => void> = {};
  const worker = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: ErrorEvent) => void) | null,
    postMessage: vi.fn((_msg: unknown, _transfer?: unknown[]) => {
      // 不做实际处理；外部通过 fireMessage 触发 onmessage
    }),
    terminate: vi.fn(),
    // 辅助方法：模拟 Worker 发回消息
    _fireMessage(data: unknown) {
      if (worker.onmessage) {
        worker.onmessage({ data } as MessageEvent);
      }
    },
  };

  // postMessage 被调用时，如果是 init 则自动回复 ready
  const origPostMessage = worker.postMessage;
  worker.postMessage = vi.fn((msg: unknown, transfer?: unknown[]) => {
    const m = msg as { type: string };
    if (m.type === "init") {
      // 异步回复 ready，模拟真实 Worker 的 round-trip
      setTimeout(() => {
        worker._fireMessage({ type: "ready" });
      }, 0);
    }
    if (m.type === "compose") {
      // 异步回复 result
      setTimeout(() => {
        worker._fireMessage({
          type: "result",
          buffer: MINI_JPG.buffer.slice(0),
        });
      }, 0);
    }
    return origPostMessage(msg, transfer);
  });

  return worker as unknown as Worker;
}

beforeEach(() => {
  vi.clearAllMocks();

  // 注入假的 Worker 和 URL.createObjectURL
  (globalThis as any).Worker = vi.fn(() => makeMockWorker());
  (globalThis as any).URL = { createObjectURL: vi.fn(() => "blob:fake") };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).Worker;
});

import { composePrintImage, collectJpgFiles } from "../compositor";
import type { FolderTreeNode } from "../../../types/materialList";

function makeFakeFile(name: string, ext = "jpg"): FolderTreeNode {
  return {
    name,
    path: `/fake/${name}`,
    is_dir: false,
    extension: ext,
    file_type: "other",
    empty: false,
    children: [],
  };
}

function makeFakeDir(name: string, children: FolderTreeNode[] = []): FolderTreeNode {
  return {
    name,
    path: `/fake/${name}`,
    is_dir: true,
    extension: null,
    file_type: "folder",
    empty: children.length === 0,
    children,
  };
}

describe("collectJpgFiles", () => {
  it("收集子目录中匹配 _pNNN.jpg 模式的预览图", () => {
    const tree = makeFakeDir("taskOutputDir", [
      makeFakeDir("report1", [
        makeFakeFile("report1_p001.jpg"),
        makeFakeFile("report1_p002.jpg"),
      ]),
    ]);
    const result = collectJpgFiles(tree);
    expect(result).toHaveLength(2);
  });

  it("跳过根目录的资料列表文件", () => {
    const tree = makeFakeDir("taskOutputDir", [
      makeFakeFile("资料列表_01.jpg"),
      makeFakeFile("资料列表_02.jpg"),
      makeFakeDir("report1", [
        makeFakeFile("report1_p001.jpg"),
      ]),
    ]);
    const result = collectJpgFiles(tree);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("report1_p001.jpg");
  });

  it("跳过不匹配 _pNNN 模式的 JPG", () => {
    const tree = makeFakeDir("taskOutputDir", [
      makeFakeDir("report1", [
        makeFakeFile("report1_p001.jpg"),
        makeFakeFile("random_photo.jpg"),
      ]),
    ]);
    const result = collectJpgFiles(tree);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("report1_p001.jpg");
  });

  it("跳过仿打印文件夹", () => {
    const tree = makeFakeDir("taskOutputDir", [
      makeFakeDir("仿打印", [makeFakeFile("001.jpg")]),
      makeFakeDir("report1", [makeFakeFile("report1_p001.jpg")]),
    ]);
    const result = collectJpgFiles(tree);
    expect(result).toHaveLength(1);
  });

  it("跳过非 JPG 文件（即使匹配 _pNNN 模式）", () => {
    const tree = makeFakeDir("taskOutputDir", [
      makeFakeDir("report1", [makeFakeFile("report1_p001.png", "png")]),
    ]);
    const result = collectJpgFiles(tree);
    expect(result).toHaveLength(0);
  });

  it("空树返回空数组", () => {
    const tree = makeFakeDir("taskOutputDir", []);
    expect(collectJpgFiles(tree)).toEqual([]);
  });

  it("无预览图的目录返回空数组", () => {
    const tree = makeFakeDir("taskOutputDir", [makeFakeDir("report1", [])]);
    expect(collectJpgFiles(tree)).toEqual([]);
  });
});

describe("composePrintImage", () => {
  let worker: Worker;

  beforeEach(() => {
    worker = new (globalThis as any).Worker();
    invokeMock.mockResolvedValue(new Uint8Array([0x89]).buffer);
  });

  it("返回 Uint8Array", async () => {
    const result = await composePrintImage({
      worker,
      bgIndex: 0,
      bgW: 100,
      bgH: 100,
      corners: [0, 0, 1, 0, 1, 1, 0, 1],
      materialBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(result).toBeInstanceOf(Uint8Array);
  });

  it("输出以 JPG SOI 开头", async () => {
    const result = await composePrintImage({
      worker,
      bgIndex: 0,
      bgW: 100,
      bgH: 100,
      corners: [0, 0, 1, 0, 1, 1, 0, 1],
      materialBytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
  });

  it("调用 invoke warp_to_a4 且传递 Uint8Array", async () => {
    const materialBytes = new Uint8Array([0xff, 0xd9]);
    await composePrintImage({
      worker,
      bgIndex: 0,
      bgW: 200,
      bgH: 300,
      corners: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],
      materialBytes,
    });

    expect(invokeMock).toHaveBeenCalledWith("warp_to_a4", {
      materialBytes,
      bgW: 200,
      bgH: 300,
      corners: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],
    });
  });

  it("Worker 合成失败时向上抛出", async () => {
    // 创建一个会报错的 Worker（不自动回复 compose 成功）
    const badWorker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as ((e: ErrorEvent) => void) | null,
      postMessage: vi.fn((msg: unknown, _transfer?: unknown[]) => {
        const m = msg as { type: string };
        if (m.type === "init") {
          setTimeout(() => badWorker.onmessage?.({ data: { type: "ready" } } as MessageEvent), 0);
        }
        if (m.type === "compose") {
          setTimeout(() => badWorker.onmessage?.({ data: { type: "error", message: "合成失败" } } as MessageEvent), 0);
        }
      }),
      terminate: vi.fn(),
    };

    await expect(
      composePrintImage({
        worker: badWorker as unknown as Worker,
        bgIndex: 0,
        bgW: 100,
        bgH: 100,
        corners: [0, 0, 1, 0, 1, 1, 0, 1],
        materialBytes: new Uint8Array([0xff, 0xd8]),
      }),
    ).rejects.toThrow("合成失败");
  });
});
