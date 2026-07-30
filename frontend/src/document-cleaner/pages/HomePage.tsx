import { EmptyState } from "../../components/common/EmptyState";

const FEATURES = [
  { label: "水印", done: true },
  { label: "页眉", done: true },
  { label: "页脚", done: true },
];

export default function HomePage() {
  return (
    <div className="flex h-full flex-col gap-5">
      {/* 功能说明卡片 */}
      <div className="rounded-xl border border-workspace-border/60 bg-workspace-surface p-5 shadow-card">
        <h2 className="mb-3 text-sm font-semibold text-workspace-fg">自动检测并清理</h2>
        <div className="flex gap-6">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-green-600">
                  <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                </svg>
              </div>
              <span className="text-sm text-workspace-fg-secondary">{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 最近任务 */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-workspace-border/60 bg-workspace-surface shadow-card">
        <div className="flex items-center justify-between border-b border-workspace-border/40 px-5 py-3">
          <h3 className="text-sm font-semibold text-workspace-fg">最近任务</h3>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon="search"
            title="暂无任务"
            description="创建一个清理任务，完成后将在这里显示最近的处理记录。"
          />
        </div>
      </div>
    </div>
  );
}
