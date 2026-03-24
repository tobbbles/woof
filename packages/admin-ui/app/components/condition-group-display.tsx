import { Ban } from "lucide-react";
import type { ConditionGroup } from "~/types/rule";

const operatorLabels: Record<string, string> = {
  equals: "=",
  not_equals: "\u2260",
  in: "\u2208",
  ends_with: "ends with",
  greater_than: ">",
  less_than: "<",
  contains: "contains",
  semver_gte: "\u2265",
  semver_lte: "\u2264",
};

const logicBadge = {
  AND: "bg-blue-100 text-blue-700",
  OR: "bg-amber-100 text-amber-700",
};

interface ConditionGroupDisplayProps {
  group: ConditionGroup;
  depth?: number;
}

export function ConditionGroupDisplay({ group, depth = 0 }: ConditionGroupDisplayProps) {
  const totalItems = group.conditions.length + group.groups.length;

  if (totalItems === 0) {
    return <span className="text-xs text-muted-foreground italic">Empty group</span>;
  }

  const allItems: { type: "condition" | "group"; index: number }[] = [
    ...group.conditions.map((_, i) => ({
      type: "condition" as const,
      index: i,
    })),
    ...group.groups.map((_, i) => ({ type: "group" as const, index: i })),
  ];

  return (
    <div className={`space-y-1.5 ${depth > 0 ? "ml-4 pl-3 border-l-2 border-dashed border-muted-foreground/20" : ""}`}>
      {allItems.map((item, pos) => (
        <div key={`${item.type}-${item.index}`}>
          {pos > 0 && (
            <span className={`inline-block text-xs px-2 py-0.5 rounded mb-1 ${logicBadge[group.logic]}`}>
              {group.logic}
            </span>
          )}
          {item.type === "condition" ? (
            <div className="flex items-center gap-2 text-sm">
              {group.conditions[item.index].negate && (
                <span className="flex items-center gap-0.5 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                  <Ban className="w-3 h-3" /> NOT
                </span>
              )}
              <code className="bg-muted px-2 py-1 rounded">
                {group.conditions[item.index].attribute || (
                  <span className="text-muted-foreground italic">attribute</span>
                )}
              </code>
              <span className="text-muted-foreground">
                {operatorLabels[group.conditions[item.index].operator] || group.conditions[item.index].operator}
              </span>
              <code className="bg-muted px-2 py-1 rounded">
                {group.conditions[item.index].value || <span className="text-muted-foreground italic">value</span>}
              </code>
            </div>
          ) : (
            <ConditionGroupDisplay group={group.groups[item.index]} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}
