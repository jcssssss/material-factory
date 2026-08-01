// warp_to_a4 二进制 body 编解码测试。
//
// 前后端格式对账：前端 buildWarpRequestBody 按
//   [4B LE material_len][material_bytes][4B LE bgW][4B LE bgH][8×f64 LE corners]
// 编码，Rust parse_warp_request 按同格式解析。本测试用与 Rust 相同的解析逻辑
// 反解前端 body，确保两端格式一致（warp.rs 的 parse_warp_request 单测覆盖 Rust 侧）。

import { describe, it, expect } from "vitest";
import { buildWarpRequestBody } from "../compositor";
import type { CalibrationCorners } from "../../../types/background";

// 模拟 Rust parse_warp_request 的解析逻辑（仅用于对账，非生产代码）。
function parseBodyLikeRust(body: Uint8Array): {
  materialBytes: Uint8Array;
  bgW: number;
  bgH: number;
  corners: number[];
} {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const materialLen = dv.getUint32(0, true);
  const materialBytes = body.subarray(4, 4 + materialLen);
  const bgW = dv.getUint32(4 + materialLen, true);
  const bgH = dv.getUint32(8 + materialLen, true);
  const corners: number[] = [];
  for (let i = 0; i < 8; i++) {
    corners.push(dv.getFloat64(12 + materialLen + i * 8, true));
  }
  return { materialBytes, bgW, bgH, corners };
}

const FULL_CORNERS: CalibrationCorners = [0, 0, 1, 0, 1, 1, 0, 1];

describe("buildWarpRequestBody", () => {
  it("body 总长 = 4 + material_len + 8 + 64", () => {
    const material = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const body = buildWarpRequestBody(material, 1242, 1656, FULL_CORNERS);
    expect(body.length).toBe(4 + 4 + 8 + 64);
  });

  it("Rust 反解后字段与输入一致", () => {
    const material = new Uint8Array([10, 20, 30, 40, 50]);
    const corners: CalibrationCorners = [0.1, 0.2, 0.9, 0.1, 0.95, 0.9, 0.05, 0.85];
    const bgW = 1242;
    const bgH = 1656;

    const body = buildWarpRequestBody(material, bgW, bgH, corners);
    const parsed = parseBodyLikeRust(body);

    expect([...parsed.materialBytes]).toEqual([10, 20, 30, 40, 50]);
    expect(parsed.bgW).toBe(bgW);
    expect(parsed.bgH).toBe(bgH);
    expect(parsed.corners).toEqual(corners);
  });

  it("material 为空也能正确编码", () => {
    const body = buildWarpRequestBody(new Uint8Array(0), 100, 200, FULL_CORNERS);
    expect(body.length).toBe(4 + 0 + 8 + 64);
    const parsed = parseBodyLikeRust(body);
    expect(parsed.materialBytes.length).toBe(0);
    expect(parsed.bgW).toBe(100);
    expect(parsed.bgH).toBe(200);
  });

  it("invoke 顶层传的是单个 Uint8Array（二进制通道，非对象）", () => {
    const material = new Uint8Array([1, 2, 3]);
    const body = buildWarpRequestBody(material, 10, 20, FULL_CORNERS);
    // 顶层即 Uint8Array：Tauri 据此走 octet-stream，而非 JSON 对象。
    expect(body).toBeInstanceOf(Uint8Array);
    expect(body.byteLength).toBe(4 + 3 + 8 + 64);
  });
});
