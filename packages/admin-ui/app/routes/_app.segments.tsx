import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useFetcher, useLoaderData } from "@remix-run/react";
import type { ConditionGroup, Rule } from "@woof/types";
import { Check, Edit2, Flag, Plus, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import { ConditionGroupDisplay } from "~/components/condition-group-display";
import { ConditionGroupEditor } from "~/components/condition-group-editor";
import { getApiClient } from "~/lib/api.server";
import type { Segment } from "~/types/rule";
import { countConditions, emptyConditionGroup } from "~/types/rule";

export const meta: MetaFunction = () => [{ title: "Segments — Woof" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const [{ segments }, { rules }] = await Promise.all([api.listSegments(), api.listRules()]);
  return json({ segments, rules });
}

export async function action({ request, context }: ActionFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const form = await request.formData();
  const intent = form.get("intent") as string;

  switch (intent) {
    case "create": {
      const name = form.get("name") as string;
      const key = form.get("key") as string;
      const description = (form.get("description") as string) || "";
      const conditionGroup = JSON.parse(form.get("conditionGroup") as string) as ConditionGroup;
      await api.createSegment({ name, key, description, conditionGroup });
      break;
    }
    case "update": {
      const segKey = form.get("segKey") as string;
      const name = form.get("name") as string;
      const description = (form.get("description") as string) || "";
      const conditionGroup = JSON.parse(form.get("conditionGroup") as string) as ConditionGroup;
      await api.updateSegment(segKey, { name, description, conditionGroup });
      break;
    }
    case "delete": {
      const segKey = form.get("segKey") as string;
      await api.deleteSegment(segKey);
      break;
    }
    default:
      return json({ error: "Unknown intent" }, 400);
  }

  const { segments } = await api.listSegments();
  return json({ segments });
}

export default function SegmentsPage() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  const segments = ((fetcher.data as { segments?: Segment[] })?.segments ?? loaderData.segments) as Segment[];
  const rules = (loaderData as { rules?: Rule[] }).rules ?? ([] as Rule[]);

  const [showCreate, setShowCreate] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newSeg, setNewSeg] = useState({
    name: "",
    key: "",
    description: "",
    conditionGroup: emptyConditionGroup(),
  });
  const [editData, setEditData] = useState<{
    name: string;
    description: string;
    conditionGroup: ConditionGroup;
  } | null>(null);

  const handleCreate = () => {
    if (!newSeg.name || !newSeg.key) return;
    fetcher.submit(
      {
        intent: "create",
        name: newSeg.name,
        key: newSeg.key,
        description: newSeg.description,
        conditionGroup: JSON.stringify(newSeg.conditionGroup),
      },
      { method: "post" },
    );
    setNewSeg({
      name: "",
      key: "",
      description: "",
      conditionGroup: emptyConditionGroup(),
    });
    setShowCreate(false);
  };

  const handleEdit = (seg: Segment) => {
    setEditingKey(seg.key);
    setEditData({
      name: seg.name,
      description: seg.description,
      conditionGroup: seg.conditionGroup,
    });
    setShowCreate(false);
  };

  const handleSaveEdit = () => {
    if (!editingKey || !editData) return;
    fetcher.submit(
      {
        intent: "update",
        segKey: editingKey,
        name: editData.name,
        description: editData.description,
        conditionGroup: JSON.stringify(editData.conditionGroup),
      },
      { method: "post" },
    );
    setEditingKey(null);
    setEditData(null);
  };

  const handleDelete = (key: string) => {
    fetcher.submit({ intent: "delete", segKey: key }, { method: "post" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1>Segments</h1>
          <p className="text-muted-foreground mt-1">
            Reusable user cohorts with AND/OR logic — update once, apply everywhere
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(true);
            setEditingKey(null);
            setEditData(null);
          }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-lg hover:opacity-90 transition"
        >
          <Plus className="w-4 h-4" /> New Segment
        </button>
      </div>

      {showCreate && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3>Create Segment</h3>
            <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <input
              placeholder="Segment Name"
              value={newSeg.name}
              onChange={(e) => setNewSeg({ ...newSeg, name: e.target.value })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg"
            />
            <input
              placeholder="Segment Key"
              value={newSeg.key}
              onChange={(e) => setNewSeg({ ...newSeg, key: e.target.value })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg font-mono"
            />
            <input
              placeholder="Description"
              value={newSeg.description}
              onChange={(e) => setNewSeg({ ...newSeg, description: e.target.value })}
              className="col-span-2 px-3 py-2 bg-input-background border border-border rounded-lg"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Conditions</label>
            <ConditionGroupEditor
              group={newSeg.conditionGroup}
              onChange={(g) => setNewSeg({ ...newSeg, conditionGroup: g })}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newSeg.name || !newSeg.key}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" /> Create Segment
          </button>
        </div>
      )}

      {editingKey && editData && (
        <div className="bg-card border-2 border-primary/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3>Edit Segment</h3>
            <button
              onClick={() => {
                setEditingKey(null);
                setEditData(null);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <input
              value={editData.name}
              onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              className="px-3 py-2 bg-input-background border border-border rounded-lg"
            />
            <input
              value={editingKey}
              disabled
              className="px-3 py-2 bg-input-background border border-border rounded-lg font-mono opacity-50"
            />
            <input
              value={editData.description}
              onChange={(e) => setEditData({ ...editData, description: e.target.value })}
              className="col-span-2 px-3 py-2 bg-input-background border border-border rounded-lg"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-2">Conditions</label>
            <ConditionGroupEditor
              group={editData.conditionGroup}
              onChange={(g) => setEditData({ ...editData, conditionGroup: g })}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveEdit}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:opacity-90"
            >
              <Check className="w-4 h-4" /> Save
            </button>
            <button
              onClick={() => {
                setEditingKey(null);
                setEditData(null);
              }}
              className="px-4 py-2 border border-border rounded-lg text-muted-foreground hover:text-foreground transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {segments.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {segments.map((seg: Segment) => {
            const condCount = countConditions(seg.conditionGroup);
            const matchingRules = (rules as Rule[]).filter(
              (r) => r.segmentIds?.includes(seg.id) || r.segmentIds?.includes(seg.key),
            );
            const flagKeys = [...new Set(matchingRules.map((r) => r.flagKey))];
            return (
              <div key={seg.key} className="bg-card border border-border rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                      <Users className="w-4 h-4 text-purple-700" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">{seg.name}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            seg.conditionGroup.logic === "AND"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {seg.conditionGroup.logic}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {condCount} cond{condCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <code className="text-xs text-muted-foreground">{seg.key}</code>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(seg)}
                      className="text-muted-foreground hover:text-foreground transition p-1"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(seg.key)}
                      className="text-muted-foreground hover:text-destructive transition p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {seg.description && <p className="text-sm text-muted-foreground">{seg.description}</p>}
                <ConditionGroupDisplay group={seg.conditionGroup} />
                {flagKeys.length > 0 ? (
                  <div className="pt-3 border-t border-border">
                    <div className="text-xs text-muted-foreground mb-1.5">
                      Used by {flagKeys.length} flag{flagKeys.length !== 1 ? "s" : ""} across {matchingRules.length}{" "}
                      rule{matchingRules.length !== 1 ? "s" : ""}
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {flagKeys.map((fk) => (
                        <span key={fk} className="text-xs bg-muted px-2 py-1 rounded flex items-center gap-1">
                          <Flag className="w-2.5 h-2.5" /> {fk}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pt-3 border-t border-border">
                    <span className="text-xs text-muted-foreground">Not used by any rules</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !showCreate && (
          <div className="bg-card border border-border rounded-xl py-16 flex flex-col items-center text-muted-foreground">
            <Users className="w-10 h-10 mb-3" />
            <p>No segments yet.</p>
            <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-primary hover:opacity-80">
              Create one
            </button>
          </div>
        )
      )}
    </div>
  );
}
