import type { BackgroundTemplate } from "../../types/background";
import TemplateCard from "./TemplateCard";

type Props = {
  templates: BackgroundTemplate[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: (id: string) => void;
};

export default function TemplateGrid({
  templates,
  selectedIds,
  onToggleSelect,
  onDelete,
  onClick,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {templates.map((t) => (
        <TemplateCard
          key={t.id}
          template={t}
          selected={selectedIds.has(t.id)}
          onToggleSelect={onToggleSelect}
          onDelete={onDelete}
          onClick={onClick}
        />
      ))}
    </div>
  );
}
