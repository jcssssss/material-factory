import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("渲染标题", () => {
    render(<EmptyState title="暂无数据" />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });

  it("不传 description 时不渲染描述", () => {
    const { container } = render(<EmptyState title="空" />);
    // description 是可选的，没有 description 时对应的 div 不应出现
    expect(container.querySelector(".max-w-md")).toBeNull();
  });

  it("渲染描述文本", () => {
    render(<EmptyState title="空" description="这里什么都没有" />);
    expect(screen.getByText("这里什么都没有")).toBeInTheDocument();
  });

  it("渲染操作按钮", () => {
    render(
      <EmptyState
        title="请添加文件"
        action={<button type="button">添加</button>}
      />
    );
    expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument();
  });

  it("标题和描述同时渲染", () => {
    render(<EmptyState title="队列为空" description="请先创建任务" />);
    expect(screen.getByText("队列为空")).toBeInTheDocument();
    expect(screen.getByText("请先创建任务")).toBeInTheDocument();
  });
});
