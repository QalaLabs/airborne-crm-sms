"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Menu,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  CornerDownRight,
  ExternalLink,
  Save,
  Globe,
  Loader2,
  RefreshCw,
  FolderPlus,
} from "lucide-react";
import type { NavMenu } from "@prisma/client";
import type { NavItem } from "@/lib/validations/nav.schema";

export function NavMenuEditor() {
  const queryClient = useQueryClient();
  const [selectedMenuId, setSelectedMenuId] = React.useState<string | null>(null);
  const [createLocation, setCreateLocation] = React.useState<string | null>(null);
  const [createMenuName, setCreateMenuName] = React.useState("");

  // Edit states for selected menu
  const [menuName, setMenuName] = React.useState("");
  const [menuItems, setMenuItems] = React.useState<NavItem[]>([]);

  // Item form states
  const [itemLabel, setItemLabel] = React.useState("");
  const [itemUrl, setItemUrl] = React.useState("");
  const [itemTarget, setItemTarget] = React.useState<"_self" | "_blank">("_self");
  const [itemVisible, setItemVisible] = React.useState(true);
  const [parentId, setParentId] = React.useState<string | null>(null); // For child items

  // Fetch navigation menus
  const { data: menus = [], isLoading, isError, refetch } = useQuery<NavMenu[]>({
    queryKey: ["nav-menus"],
    queryFn: () => apiFetch<NavMenu[]>("/nav"),
  });

  const selectedMenu = menus.find((m) => m.id === selectedMenuId);

  React.useEffect(() => {
    if (selectedMenu) {
      setMenuName(selectedMenu.name);
      setMenuItems((selectedMenu.items as unknown as NavItem[]) || []);
    } else {
      setMenuName("");
      setMenuItems([]);
    }
  }, [selectedMenu]);

  // Create menu mutation
  const createMutation = useMutation({
    mutationFn: (body: { name: string; location: string }) =>
      apiFetch<NavMenu>("/nav", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (newMenu) => {
      queryClient.invalidateQueries({ queryKey: ["nav-menus"] });
      setSelectedMenuId(newMenu.id);
      setCreateLocation(null);
      setCreateMenuName("");
      toast({ title: "Navigation menu created", description: "You can now populate items." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create menu", description: err.message, variant: "destructive" });
    },
  });

  // Save menu items mutation
  const saveMutation = useMutation({
    mutationFn: (body: { name: string; items: NavItem[] }) =>
      apiFetch<NavMenu>(`/nav/${selectedMenuId}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nav-menus"] });
      toast({ title: "Navigation saved", description: "Changes propagated to website settings." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save navigation", description: err.message, variant: "destructive" });
    },
  });

  // Delete menu mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/nav/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nav-menus"] });
      setSelectedMenuId(null);
      toast({ title: "Navigation menu deleted", description: "Dynamic location returns to hardcoded fallback." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete menu", description: err.message, variant: "destructive" });
    },
  });

  const handleCreateMenu = () => {
    if (!createMenuName.trim() || !createLocation) return;
    createMutation.mutate({
      name: createMenuName.trim(),
      location: createLocation,
    });
  };

  const handleSaveMenu = () => {
    if (!selectedMenuId) return;
    saveMutation.mutate({
      name: menuName,
      items: menuItems,
    });
  };

  const handleDeleteMenu = (id: string) => {
    if (confirm("Are you sure you want to delete this menu? The public site will fall back to default hardcoded links.")) {
      deleteMutation.mutate(id);
    }
  };

  // Add navigation item
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemLabel.trim() || !itemUrl.trim()) return;

    const newItem: NavItem = {
      id: crypto.randomUUID(),
      label: itemLabel.trim(),
      url: itemUrl.trim(),
      target: itemTarget,
      isVisible: itemVisible,
      children: [],
    };

    if (parentId) {
      // Add as nested item (child)
      setMenuItems(
        menuItems.map((item) => {
          if (item.id === parentId) {
            return {
              ...item,
              children: [...(item.children || []), newItem],
            };
          }
          return item;
        }),
      );
    } else {
      // Add as top-level item
      setMenuItems([...menuItems, newItem]);
    }

    // Reset fields
    setItemLabel("");
    setItemUrl("");
    setItemTarget("_self");
    setItemVisible(true);
    setParentId(null);
  };

  // Remove navigation item
  const handleRemoveItem = (id: string) => {
    // Check if it's a top level item
    if (menuItems.some((item) => item.id === id)) {
      setMenuItems(menuItems.filter((item) => item.id !== id));
    } else {
      // Check children
      setMenuItems(
        menuItems.map((item) => ({
          ...item,
          children: (item.children || []).filter((child: NavItem) => child.id !== id),
        })),
      );
    }
  };

  // Move item up
  const handleMoveItem = (idx: number, direction: "up" | "down") => {
    const updated = [...menuItems];
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= updated.length) return;

    const itemA = updated[idx];
    const itemB = updated[targetIdx];
    if (itemA && itemB) {
      updated[idx] = itemB;
      updated[targetIdx] = itemA;
      setMenuItems(updated);
    }
  };

  // Move child item up/down
  const handleMoveChildItem = (parentIdx: number, childIdx: number, direction: "up" | "down") => {
    const updated = [...menuItems];
    const parent = updated[parentIdx];
    if (!parent || !parent.children) return;

    const targetIdx = direction === "up" ? childIdx - 1 : childIdx + 1;
    if (targetIdx < 0 || targetIdx >= parent.children.length) return;

    const children = [...parent.children];
    const childA = children[childIdx];
    const childB = children[targetIdx];
    if (childA && childB) {
      children[childIdx] = childB;
      children[targetIdx] = childA;
      updated[parentIdx] = { ...parent, children };
      setMenuItems(updated);
    }
  };

  // Locations setup
  const LOCATIONS = [
    { id: "header", label: "Header Main Menu", desc: "Top site navigation" },
    { id: "footer", label: "Footer Links Menu", desc: "Site footer links columns" },
    { id: "sidebar", label: "Staff Dashboard Sidebar", desc: "Portal sidebar links" },
  ];

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground font-semibold">Loading Navigation Menus...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Locations and Menus selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {LOCATIONS.map((loc) => {
          const menu = menus.find((m) => m.location === loc.id);
          const isSelected = menu?.id === selectedMenuId;

          return (
            <div
              key={loc.id}
              className={`glass-card rounded-2xl p-5 border flex flex-col justify-between transition-all ${
                isSelected ? "border-primary shadow-lg shadow-primary/10" : "border-white/10"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {loc.label}
                  </span>
                  <span
                    className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                      menu
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {menu ? "Dynamic" : "Fallback"}
                  </span>
                </div>
                <h4 className="text-base font-bold text-white mt-3">{menu ? menu.name : "Hardcoded Default"}</h4>
                <p className="text-xs text-muted-foreground mt-1">{loc.desc}</p>
                {menu && (
                  <p className="text-[10px] font-mono text-muted-foreground mt-3">
                    Items count: {((menu.items as unknown as NavItem[]) || []).length}
                  </p>
                )}
              </div>

              <div className="flex gap-2 mt-5">
                {menu ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => setSelectedMenuId(menu.id)}
                      className={`flex-1 text-xs font-bold ${
                        isSelected ? "bg-primary text-white" : "bg-secondary/40 text-white"
                      }`}
                    >
                      <Menu className="h-3.5 w-3.5 mr-1.5" /> Edit Menu
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteMenu(menu.id)}
                      className="border-white/10 hover:bg-red-500/10 text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => {
                      setCreateLocation(loc.id);
                      setCreateMenuName(loc.label);
                    }}
                    className="flex-1 bg-primary/20 text-primary border border-primary/30 text-xs font-bold hover:bg-primary/30"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Menu
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Menu item builder */}
      {selectedMenu && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
          {/* Main items builder list */}
          <div className="lg:col-span-2 glass-card rounded-2xl p-6 border border-white/10 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Menu className="h-5 w-5 text-primary" /> Navigation Items Layout
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Location: <span className="font-mono text-primary uppercase">{selectedMenu.location}</span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleSaveMenu}
                  disabled={saveMutation.isPending}
                  className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20"
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Save Changes
                </Button>
              </div>
            </div>

            {/* Menu Name Input */}
            <div className="space-y-1.5 max-w-sm">
              <label className="text-xs font-bold text-muted-foreground">Menu Name</label>
              <Input
                value={menuName}
                onChange={(e) => setMenuName(e.target.value)}
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
              />
            </div>

            {/* Render Items */}
            {menuItems.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-white/10 rounded-xl">
                <Plus className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                <p className="text-xs text-muted-foreground font-semibold">No menu items added yet.</p>
                <p className="text-[10px] text-muted-foreground mt-1">Use the form on the right to add links.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {menuItems.map((item, idx) => {
                  const children = item.children || [];
                  return (
                    <div key={item.id} className="space-y-2">
                      {/* Top level item card */}
                      <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/30 border border-white/5 hover:border-white/10 transition-colors">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <span className="text-[10px] font-extrabold font-mono text-muted-foreground bg-white/5 border border-white/10 px-2 py-0.5 rounded">
                            {idx + 1}
                          </span>
                          <div className="truncate">
                            <span className="text-xs font-bold text-white">{item.label}</span>
                            <span className="text-[10px] font-mono text-muted-foreground ml-3 truncate">
                              {item.url}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setItemLabel(item.label);
                              setItemUrl(item.url);
                              setItemTarget(item.target || "_self");
                              setItemVisible(item.isVisible !== false);
                              handleRemoveItem(item.id);
                            }}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-white"
                            title="Edit Link details"
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setParentId(item.id)}
                            className="h-7 w-7 p-0 text-primary hover:text-primary-hover"
                            title="Add sub-item"
                          >
                            <FolderPlus className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={idx === 0}
                            onClick={() => handleMoveItem(idx, "up")}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-white disabled:opacity-30"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={idx === menuItems.length - 1}
                            onClick={() => handleMoveItem(idx, "down")}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-white disabled:opacity-30"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveItem(item.id)}
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Nested level (Children) */}
                      {children.map((child: NavItem, cIdx: number) => (
                        <div
                          key={child.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-secondary/15 border border-white/5 border-dashed ml-8 hover:border-white/10 transition-colors"
                        >
                          <div className="flex items-center gap-2 overflow-hidden">
                            <CornerDownRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="truncate">
                              <span className="text-xs font-bold text-white/95">{child.label}</span>
                              <span className="text-[10px] font-mono text-muted-foreground ml-3 truncate">
                                {child.url}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setItemLabel(child.label);
                                setItemUrl(child.url);
                                setItemTarget(child.target || "_self");
                                setItemVisible(child.isVisible !== false);
                                setParentId(item.id);
                                handleRemoveItem(child.id);
                              }}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-white text-[10px]"
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={cIdx === 0}
                              onClick={() => handleMoveChildItem(idx, cIdx, "up")}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-white disabled:opacity-30"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={cIdx === children.length - 1}
                              onClick={() => handleMoveChildItem(idx, cIdx, "down")}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-white disabled:opacity-30"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveItem(child.id)}
                              className="h-6 w-6 p-0 text-red-400 hover:text-red-300"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add Link Form card */}
          <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4 h-fit">
            <h3 className="text-base font-bold text-white flex items-center gap-2 border-b border-white/10 pb-4">
              <Plus className="h-5 w-5 text-primary" />
              {parentId ? "Add Sub-item link" : "Add Top-level Link"}
            </h3>

            {parentId && (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs">
                <span className="text-white font-medium">Nesting under parent item</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setParentId(null)}
                  className="h-6 text-[10px] text-muted-foreground hover:text-white"
                >
                  Cancel
                </Button>
              </div>
            )}

            <form onSubmit={handleAddItem} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Link Label *</label>
                <Input
                  value={itemLabel}
                  onChange={(e) => setItemLabel(e.target.value)}
                  placeholder="e.g. Courses"
                  required
                  className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Link URL *</label>
                <Input
                  value={itemUrl}
                  onChange={(e) => setItemUrl(e.target.value)}
                  placeholder="e.g. /courses or https://"
                  required
                  className="bg-secondary/40 border-white/10 text-xs font-mono text-white font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground">Target Behavior</label>
                  <select
                    value={itemTarget}
                    onChange={(e) => setItemTarget(e.target.value as "_self" | "_blank")}
                    className="w-full h-9 rounded-lg border border-white/10 bg-secondary/40 text-xs text-white px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="_self">Same tab (_self)</option>
                    <option value="_blank">New tab (_blank)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground">Visibility Status</label>
                  <div className="flex items-center h-9">
                    <Switch
                      checked={itemVisible}
                      onCheckedChange={setItemVisible}
                      className="data-[state=checked]:bg-primary"
                    />
                    <span className="text-xs text-muted-foreground ml-2">
                      {itemVisible ? "Visible" : "Hidden"}
                    </span>
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full bg-primary hover:bg-primary/90 text-white text-xs font-bold mt-2">
                <Plus className="h-4 w-4 mr-1.5" /> {parentId ? "Add Sub-link" : "Add Link to List"}
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createLocation !== null} onOpenChange={(o) => !o && setCreateLocation(null)}>
        <DialogContent className="max-w-sm glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Globe className="h-5 w-5 text-primary" /> Create Navigation Menu
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Menu Display Name</label>
              <Input
                value={createMenuName}
                onChange={(e) => setCreateMenuName(e.target.value)}
                placeholder="e.g. Header Main Menu"
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              This will allocate a dynamic menu in the database for the location <span className="font-mono text-primary font-bold uppercase">{createLocation}</span>.
            </p>
          </div>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setCreateLocation(null)} className="border-white/10 text-xs">
              Cancel
            </Button>
            <Button
              onClick={handleCreateMenu}
              disabled={!createMenuName.trim() || createMutation.isPending}
              className="bg-primary text-white text-xs font-bold"
            >
              {createMutation.isPending ? "Creating..." : "Create Menu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
