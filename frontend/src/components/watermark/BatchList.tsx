import type { FC } from "react";
import type { BatchItem } from "../../types/watermark";

interface BatchListProps {
  items: BatchItem[];
  onRemoveItem: (id: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  detecting: "检测中…",
  removing: "去除中…",
  done: "已完成",
  no_watermark: "无水印",
  failed: "失败",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-workspace-muted",
  detecting: "text-indigo-500",
  removing: "text-indigo-500",
  done: "text-green-600",
  no_watermark: "text-green-600",
  failed: "text-red-500",
};

const BatchList: FC<BatchListProps> = ({ items, onRemoveItem }) => {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-workspace-muted">
        点击「添加文件夹」或「添加文件」开始
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-workspace-border/40 text-workspace-muted">
            <th className="pb-2 pr-4 font-medium">文件名</th>
            <th className="pb-2 pr-4 font-medium">分组</th>
            <th className="pb-2 pr-4 font-medium">状态</th>
            <th className="pb-2 pr-4 font-medium">检测结果</th>
            <th className="pb-2 pr-2 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-workspace-border/20">
              <td className="py-2 pr-4 text-workspace-fg" title={item.path}>
                {item.name}
              </td>
              <td className="py-2 pr-4 text-workspace-muted">{item.groupName}</td>
              <td className={`py-2 pr-4 ${STATUS_COLOR[item.status] ?? ""}`}>
                {STATUS_LABEL[item.status] ?? item.status}
              </td>
              <td className="py-2 pr-4 text-workspace-muted">
                {item.report?.summary ?? item.errorMessage ?? "-"}
              </td>
              <td className="py-2 pr-2">
                <button
                  onClick={() => onRemoveItem(item.id)}
                  className="text-workspace-muted hover:text-red-500"
                  disabled={item.status === "detecting" || item.status === "removing"}
                  title="移除"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default BatchList;
