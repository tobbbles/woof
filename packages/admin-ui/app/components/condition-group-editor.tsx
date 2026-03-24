import { Ban, ChevronDown, FolderPlus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Condition, ConditionGroup } from "~/types/rule";

const operatorOptions = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "not equals" },
  { value: "in", label: "in" },
  { value: "contains", label: "contains" },
  { value: "ends_with", label: "ends with" },
  { value: "greater_than", label: ">" },
  { value: "less_than", label: "<" },
  { value: "semver_gte", label: ">= (semver)" },
  { value: "semver_lte", label: "<= (semver)" },
];

/** Attribute input with autocomplete dropdown from known context keys. */
function AttributeInput({
  value,
  onChange,
  contextKeys,
}: {
  value: string;
  onChange: (value: string) => void;
  contextKeys?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const suggestions =
    contextKeys?.filter((k) => k !== value && k.toLowerCase().includes((filter || value).toLowerCase())) ?? [];
  const showDropdown = open && suggestions.length > 0;

  return (
    <div className="relative flex-1 min-w-0" ref={ref}>
      <div className="flex">
        <input
          placeholder="attribute"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setFilter(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFilter(value);
            setOpen(true);
          }}
          className="flex-1 px-3 py-1.5 bg-white border border-border rounded-lg text-sm min-w-0 pr-7"
        />
        {contextKeys && contextKeys.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setFilter("");
              setOpen(!open);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/50 hover:text-muted-foreground transition"
            tabIndex={-1}
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        )}
      </div>
      {showDropdown && (
        <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((k) => (
            <button
              key={k}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-muted/50 transition truncate"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(k);
                setOpen(false);
              }}
            >
              {k}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ConditionGroupEditorProps {
  group: ConditionGroup;
  onChange: (group: ConditionGroup) => void;
  depth?: number;
  onRemove?: () => void;
  /** Known context attribute keys for autocomplete suggestions. */
  contextKeys?: string[];
}

const logicColors = {
  AND: "border-blue-300 bg-blue-50",
  OR: "border-amber-300 bg-amber-50",
};

const logicBadge = {
  AND: "bg-blue-100 text-blue-700 border-blue-200",
  OR: "bg-amber-100 text-amber-700 border-amber-200",
};

export function ConditionGroupEditor({ group, onChange, depth = 0, onRemove, contextKeys }: ConditionGroupEditorProps) {
  const updateCondition = (idx: number, updates: Partial<Condition>) => {
    const conditions = [...group.conditions];
    conditions[idx] = { ...conditions[idx], ...updates };
    onChange({ ...group, conditions });
  };

  const addCondition = () => {
    onChange({
      ...group,
      conditions: [...group.conditions, { attribute: "", operator: "equals", value: "" }],
    });
  };

  const removeCondition = (idx: number) => {
    onChange({
      ...group,
      conditions: group.conditions.filter((_, i) => i !== idx),
    });
  };

  const addSubGroup = () => {
    onChange({
      ...group,
      groups: [
        ...group.groups,
        {
          logic: group.logic === "AND" ? "OR" : "AND",
          conditions: [{ attribute: "", operator: "equals", value: "" }],
          groups: [],
        },
      ],
    });
  };

  const updateSubGroup = (idx: number, subGroup: ConditionGroup) => {
    const groups = [...group.groups];
    groups[idx] = subGroup;
    onChange({ ...group, groups });
  };

  const removeSubGroup = (idx: number) => {
    onChange({
      ...group,
      groups: group.groups.filter((_, i) => i !== idx),
    });
  };

  const toggleLogic = () => {
    onChange({ ...group, logic: group.logic === "AND" ? "OR" : "AND" });
  };

  const totalItems = group.conditions.length + group.groups.length;

  return (
    <div
      className={`rounded-lg border-2 border-dashed p-3 space-y-2 ${logicColors[group.logic]} ${depth > 0 ? "ml-4" : ""}`}
    >
      {/* Group header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLogic}
            className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer transition hover:opacity-80 ${logicBadge[group.logic]}`}
            title="Click to toggle AND/OR"
          >
            {group.logic}
          </button>
          <span className="text-xs text-muted-foreground">
            {group.logic === "AND" ? "All conditions must match" : "Any condition can match"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={addCondition}
            className="text-xs text-primary hover:opacity-80 flex items-center gap-1 px-2 py-1 rounded hover:bg-white/50 transition"
            title="Add condition"
          >
            <Plus className="w-3 h-3" /> Condition
          </button>
          {depth < 2 && (
            <button
              type="button"
              onClick={addSubGroup}
              className="text-xs text-primary hover:opacity-80 flex items-center gap-1 px-2 py-1 rounded hover:bg-white/50 transition"
              title="Add nested group"
            >
              <FolderPlus className="w-3 h-3" /> Group
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-muted-foreground hover:text-destructive p-1 transition"
              title="Remove group"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Conditions */}
      {group.conditions.map((cond, i) => (
        <div key={`c-${i}`} className="flex items-center gap-2">
          {i > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${logicBadge[group.logic]}`}>{group.logic}</span>
          )}
          <button
            type="button"
            onClick={() => updateCondition(i, { negate: !cond.negate })}
            className={`shrink-0 p-1 rounded transition ${cond.negate ? "bg-red-100 text-red-600" : "text-muted-foreground/40 hover:text-red-400"}`}
            title={cond.negate ? "Negated (NOT) — click to remove" : "Click to negate (NOT)"}
          >
            <Ban className="w-3.5 h-3.5" />
          </button>
          <AttributeInput
            value={cond.attribute}
            onChange={(v) => updateCondition(i, { attribute: v })}
            contextKeys={contextKeys}
          />
          <select
            value={cond.operator}
            onChange={(e) => updateCondition(i, { operator: e.target.value })}
            className="px-2 py-1.5 bg-white border border-border rounded-lg text-sm"
          >
            {operatorOptions.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
          <input
            placeholder="value"
            value={cond.value}
            onChange={(e) => updateCondition(i, { value: e.target.value })}
            className="flex-1 px-3 py-1.5 bg-white border border-border rounded-lg text-sm min-w-0"
          />
          {totalItems > 1 && (
            <button
              type="button"
              onClick={() => removeCondition(i)}
              className="text-muted-foreground hover:text-destructive p-1 transition shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ))}

      {/* Sub-groups */}
      {group.groups.map((sub, i) => (
        <div key={`g-${i}`}>
          {(group.conditions.length > 0 || i > 0) && (
            <div className="flex items-center gap-2 my-1 ml-4">
              <span className={`text-xs px-2 py-0.5 rounded ${logicBadge[group.logic]}`}>{group.logic}</span>
              <div className="flex-1 border-t border-dashed border-muted-foreground/20" />
            </div>
          )}
          <ConditionGroupEditor
            group={sub}
            onChange={(g) => updateSubGroup(i, g)}
            depth={depth + 1}
            onRemove={() => removeSubGroup(i)}
            contextKeys={contextKeys}
          />
        </div>
      ))}

      {totalItems === 0 && (
        <div className="text-xs text-muted-foreground text-center py-2">Empty group — add a condition or sub-group</div>
      )}
    </div>
  );
}
