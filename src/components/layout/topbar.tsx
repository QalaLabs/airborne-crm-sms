"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, User, Bell, Search, Command, Sun, Moon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { apiFetch } from "@/lib/api";
import { useTheme } from "@/lib/theme";

interface TopbarProps {
  user: {
    name: string;
    email: string;
    role: string;
    avatarUrl?: string | null;
  };
}

export function Topbar({ user }: TopbarProps) {
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<any[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const { theme, setTheme } = useTheme();

  React.useEffect(() => {
    apiFetch<any[]>("/notifications")
      .then((data) => {
        setNotifications(data);
        setUnreadCount(data.length);
      })
      .catch((err) => console.error("Failed to load notifications", err));
  }, []);

  const handleSignOut = () => {
    signOut({ callbackUrl: "/login" });
  };

  return (
    <>
      <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 sticky top-0 z-40 backdrop-blur-md bg-opacity-80">
        <div className="flex items-center gap-4 flex-1 max-w-md">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center justify-between w-full h-9 px-3 rounded-lg border border-border bg-secondary/40 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all group shadow-inner"
          >
            <div className="flex items-center gap-2 text-sm">
              <Search className="h-4 w-4 text-primary group-hover:scale-110 transition-transform" />
              <span>Search modules, CRM, quick actions...</span>
            </div>
            <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-white/10 bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
              <Command className="h-3 w-3" />K
            </kbd>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-primary hover:bg-primary/10"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary hover:bg-primary/10 relative">
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary animate-pulse" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 glass-panel border-white/10 p-2 space-y-1">
              <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/15">
                <DropdownMenuLabel className="font-bold text-xs text-white p-0">System Activity Alert</DropdownMenuLabel>
                {unreadCount > 0 && (
                  <button
                    onClick={() => setUnreadCount(0)}
                    className="text-[10px] text-primary hover:underline font-semibold"
                  >
                    Clear badge
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 pt-1">
                {notifications.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-4">No recent activity.</p>
                ) : (
                  notifications.map((n) => (
                    <DropdownMenuItem
                      key={n.id}
                      className="flex flex-col items-start gap-1 p-2 rounded-lg hover:bg-white/5 transition-colors cursor-default"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {n.verb.toUpperCase()}
                        </span>
                        <span className="text-[10px] font-medium text-white/90">
                          {n.objectType}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {n.actor?.name || "System"} performed {n.verb.toLowerCase()} action on {n.objectId}
                      </p>
                      <span className="text-[9px] text-muted-foreground/60 block mt-0.5">
                        {new Date(n.occurredAt).toLocaleString("en-IN")}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-accent transition-colors outline-none border border-transparent hover:border-white/10">
                <Avatar className="h-8 w-8 border border-primary/20 shadow-sm">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                  <AvatarFallback className="text-xs bg-primary/20 text-primary font-bold">{getInitials(user.name)}</AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-semibold text-foreground leading-none">{user.name}</p>
                  <p className="text-[11px] text-primary font-medium mt-1">{user.role.replace("_", " ")}</p>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 glass-panel border-white/10">
              <DropdownMenuLabel className="font-normal p-3">
                <p className="text-sm font-bold text-white">{user.name}</p>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{user.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem
                className="cursor-pointer py-2 hover:bg-white/5"
                onClick={() => router.push("/profile")}
              >
                <User className="mr-2 h-4 w-4 text-primary" />
                <span>Profile Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive cursor-pointer py-2 hover:bg-destructive/20">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
