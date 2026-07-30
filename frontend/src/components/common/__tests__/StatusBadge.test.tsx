import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, ToneBadge } from "../StatusBadge";
import type { TaskStatus } from "../../../types/task";

describe("StatusBadge", () => {
  const cases: { status: TaskStatus; expected: string }[] = [
    { status: "pending", expected: "待执行" },
    { status: "running", expected: "执行中" },
    { status: "paused", expected: "已暂停" },
    { status: "completed", expected: "已完成" },
    { status: "completed_with_errors", expected: "部分失败" },
    { status: "failed", expected: "失败" },
    { status: "cancelled", expected: "已取消" },
  ];

  for (const { status, expected } of cases) {
    it(`状态 ${status} 显示 "${expected}"`, () => {
      render(<StatusBadge status={status} />);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });
  }

  it("每个状态渲染圆点指示器", () => {
    const { container } = render(<StatusBadge status="running" />);
    expect(container.querySelector("span.h-1\\.5.w-1\\.5")).toBeInTheDocument();
  });

  it("completed 使用成功色调", () => {
    const { container } = render(<StatusBadge status="completed" />);
    const badge = container.querySelector("div.inline-flex");
    expect(badge?.className).toContain("bg-emerald");
  });

  it("failed 使用危险色调", () => {
    const { container } = render(<StatusBadge status="failed" />);
    const badge = container.querySelector("div.inline-flex");
    expect(badge?.className).toContain("bg-destructive");
  });
});

describe("ToneBadge", () => {
  it("渲染 children", () => {
    render(<ToneBadge tone="success">通过</ToneBadge>);
    expect(screen.getByText("通过")).toBeInTheDocument();
  });

  it("success 使用 emerald 色系", () => {
    const { container } = render(<ToneBadge tone="success">OK</ToneBadge>);
    const badge = container.querySelector("div.inline-flex");
    expect(badge?.className).toContain("bg-emerald");
  });

  it("danger 使用 red 色系", () => {
    const { container } = render(<ToneBadge tone="danger">失败</ToneBadge>);
    const badge = container.querySelector("div.inline-flex");
    expect(badge?.className).toContain("bg-destructive");
  });
});
