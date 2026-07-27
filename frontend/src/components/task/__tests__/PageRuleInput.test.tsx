import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageRuleInput } from "../PageRuleInput";
import { useTaskStore } from "../../../store/useTaskStore";

beforeEach(() => {
  useTaskStore.setState({
    queue: [],
    currentTaskId: null,
    progress: null,
    currentController: null,
    history: [],
    logs: [],
    logsLoaded: false,
    draft: {
      taskName: "",
      sourceType: "files",
      sourcePaths: [],
      outputDir: "",
      pageRuleMode: "firstN",
      firstN: undefined,
      customPages: "",
    },
    breakpoints: {},
  });
});

describe("PageRuleInput", () => {
  it("默认选中「前 N 页」模式", () => {
    render(<PageRuleInput />);
    const firstNInput = screen.getByPlaceholderText("例如：5");
    expect(firstNInput).toBeInTheDocument();
  });

  it("点击「自定义」切换到自定义模式", async () => {
    const user = userEvent.setup();
    render(<PageRuleInput />);
    await user.click(screen.getByText("自定义"));
    expect(screen.getByPlaceholderText("例如：1,3,5-8")).toBeInTheDocument();
  });

  it("点击「混合」显示前 N 页 + 自定义输入", async () => {
    const user = userEvent.setup();
    render(<PageRuleInput />);
    await user.click(screen.getByText("混合"));
    expect(screen.getByPlaceholderText("例如：5")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("例如：1,3,5-8")).toBeInTheDocument();
  });

  it("三种提示文案随模式切换", async () => {
    const user = userEvent.setup();
    render(<PageRuleInput />);

    // firstN
    expect(screen.getByText(/仅按前 N 页导出/)).toBeInTheDocument();

    // custom
    await user.click(screen.getByText("自定义"));
    expect(screen.getByText(/按自定义页码导出/)).toBeInTheDocument();

    // combined
    await user.click(screen.getByText("混合"));
    expect(screen.getByText(/合并前 N 页与自定义页码/)).toBeInTheDocument();
  });

  it("前 N 页输入空值时 firstN 为 undefined", async () => {
    const user = userEvent.setup();
    render(<PageRuleInput />);
    const input = screen.getByPlaceholderText("例如：5");
    await user.type(input, "3");
    expect(useTaskStore.getState().draft.firstN).toBe(3);
    await user.clear(input);
    expect(useTaskStore.getState().draft.firstN).toBeUndefined();
  });

  it("前 N 页输入非法值时 firstN 为 undefined", async () => {
    const user = userEvent.setup();
    render(<PageRuleInput />);
    const input = screen.getByPlaceholderText("例如：5");
    await user.type(input, "0");
    expect(useTaskStore.getState().draft.firstN).toBeUndefined();
  });
});
