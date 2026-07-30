import { EmptyState } from "../../components/common/EmptyState";

export default function SettingsPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        icon="search"
        title="设置"
        description="文档清理的检测参数与偏好配置。"
      />
    </div>
  );
}
