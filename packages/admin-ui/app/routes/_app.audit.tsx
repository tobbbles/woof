import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/cloudflare";
import { json } from "@remix-run/cloudflare";
import { useLoaderData } from "@remix-run/react";
import type { AuditEntry } from "@woof/types";
import { Flag, GitBranch, Search, Settings, Users } from "lucide-react";
import { useState } from "react";
import { getApiClient } from "~/lib/api.server";

export const meta: MetaFunction = () => [{ title: "Audit Log — Woof" }];

export async function loader({ request, context }: LoaderFunctionArgs) {
  const api = getApiClient(context.cloudflare.env as Record<string, unknown>, request);
  const { entries } = await api.listAudit({ limit: 100 });
  return json({ entries });
}

const actionColors: Record<string, string> = {
  created: "bg-green-100 text-green-800",
  updated: "bg-blue-100 text-blue-800",
  deleted: "bg-red-100 text-red-800",
  toggled: "bg-yellow-100 text-yellow-800",
  evaluated: "bg-purple-100 text-purple-800",
};

const entityIcons: Record<string, React.ReactNode> = {
  flag: <Flag className="w-3.5 h-3.5" />,
  rule: <GitBranch className="w-3.5 h-3.5" />,
  segment: <Users className="w-3.5 h-3.5" />,
  settings: <Settings className="w-3.5 h-3.5" />,
};

function formatTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AuditPage() {
  const { entries } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");

  const filtered = (entries as AuditEntry[]).filter((e) => {
    const matchSearch =
      e.entityName.toLowerCase().includes(search.toLowerCase()) ||
      e.details.toLowerCase().includes(search.toLowerCase()) ||
      e.user.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "all" || e.entityType === typeFilter;
    const matchAction = actionFilter === "all" || e.action === actionFilter;
    return matchSearch && matchType && matchAction;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1>Audit Log</h1>
        <p className="text-muted-foreground mt-1">Who changed what, and when — full compliance trail</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 bg-input-background border border-border rounded-lg"
        >
          <option value="all">All Types</option>
          <option value="flag">Flags</option>
          <option value="rule">Rules</option>
          <option value="segment">Segments</option>
          <option value="settings">Settings</option>
        </select>
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="px-3 py-2.5 bg-input-background border border-border rounded-lg"
        >
          <option value="all">All Actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="deleted">Deleted</option>
          <option value="toggled">Toggled</option>
          <option value="evaluated">Evaluated</option>
        </select>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Timestamp</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">User</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Action</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Entity</th>
              <th className="text-left px-5 py-3 text-muted-foreground text-sm font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition">
                <td className="px-5 py-3">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(entry.timestamp)}</span>
                </td>
                <td className="px-5 py-3">
                  <span className="text-sm">{entry.user}</span>
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full ${actionColors[entry.action] || "bg-muted"}`}>
                    {entry.action}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1.5 text-sm">
                    {entityIcons[entry.entityType]}
                    <span>{entry.entityName}</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className="text-sm text-muted-foreground">{entry.details}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {entries.length === 0
              ? "No audit entries yet. Changes to flags, rules, and segments will appear here."
              : "No entries match your filters."}
          </div>
        )}
      </div>

      <div className="text-xs text-muted-foreground text-right">
        {filtered.length} of {entries.length} entries
      </div>
    </div>
  );
}
