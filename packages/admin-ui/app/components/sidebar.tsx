import { NavLink } from "@remix-run/react";
import { Crosshair, FileText, Flag, GitBranch, Settings, Users } from "lucide-react";

const navItems = [
  { to: "/flags", label: "Feature Flags", icon: Flag },
  { to: "/rules", label: "Rule Engine", icon: GitBranch },
  { to: "/simulator", label: "Simulator", icon: Crosshair },
  { to: "/segments", label: "Segments", icon: Users },
  { to: "/audit", label: "Audit Log", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="w-64 bg-card border-r border-border h-screen flex flex-col shrink-0">
      <NavLink to="/flags" className="p-5 border-b border-border flex items-center gap-2">
        <Flag className="w-5 h-5 text-primary" />
        <span className="text-primary">Woof</span>
      </NavLink>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`
            }
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm">
            A
          </div>
          <div>
            <div className="text-sm text-foreground">Admin User</div>
            <div className="text-xs text-muted-foreground">admin@company.io</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
