import { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Search, Plus, Pencil, Trash2 } from "lucide-react";
import { useTemplateSnippets, SNIPPET_CATEGORIES, type TemplateSnippet } from "@/hooks/useTemplateSnippets";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface Props {
  /** Called with the snippet body when a snippet is chosen */
  onInsert: (body: string) => void;
  /** Optional label override */
  label?: string;
  triggerSize?: "sm" | "xs";
}

export function SnippetPicker({ onInsert, label = "Snippets", triggerSize = "sm" }: Props) {
  const { snippets, create, update, remove } = useTemplateSnippets();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<TemplateSnippet | null>(null);

  const grouped = useMemo(() => {
    const lc = q.trim().toLowerCase();
    const filtered = snippets.filter(s =>
      !lc ||
      s.name.toLowerCase().includes(lc) ||
      s.body.toLowerCase().includes(lc) ||
      s.category.toLowerCase().includes(lc)
    );
    const map = new Map<string, TemplateSnippet[]>();
    for (const s of filtered) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [snippets, q]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={triggerSize === "xs" ? "sm" : "sm"}
            className={triggerSize === "xs" ? "h-7 px-2 gap-1 text-xs" : "h-8 px-2.5 gap-1.5 text-xs"}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {label}
            {snippets.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px]">{snippets.length}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="end">
          <div className="p-2 border-b flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search snippets..."
              className="h-7 border-0 px-1 text-xs focus-visible:ring-0"
            />
            <Button
              type="button" size="sm" variant="ghost" className="h-7 px-1.5 gap-1 text-xs"
              onClick={() => { setEditing(null); setEditorOpen(true); }}
            >
              <Plus className="h-3 w-3" /> New
            </Button>
          </div>
          <ScrollArea className="max-h-72">
            <div className="p-1">
              {grouped.length === 0 && (
                <div className="text-xs text-muted-foreground p-3 text-center">
                  No snippets yet. Create one to reuse common copy across emails.
                </div>
              )}
              {grouped.map(([cat, items]) => (
                <div key={cat} className="mb-2">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    {cat}
                  </div>
                  {items.map(s => (
                    <div
                      key={s.id}
                      className="group flex items-start gap-1 rounded hover:bg-muted/60 px-2 py-1.5 cursor-pointer"
                      onClick={() => { onInsert(s.body); setOpen(false); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{s.name}</span>
                          {s.is_shared && <Badge variant="outline" className="h-3.5 px-1 text-[9px]">Shared</Badge>}
                        </div>
                        <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                          {s.body}
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0">
                        <Button
                          type="button" size="icon" variant="ghost" className="h-5 w-5"
                          onClick={(e) => { e.stopPropagation(); setEditing(s); setEditorOpen(true); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button" size="icon" variant="ghost" className="h-5 w-5 text-destructive"
                          onClick={(e) => { e.stopPropagation(); if (confirm("Delete snippet?")) remove.mutate(s.id); }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <SnippetEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        initial={editing}
        onSubmit={async (vals) => {
          if (editing) await update.mutateAsync({ id: editing.id, ...vals });
          else await create.mutateAsync(vals as any);
          setEditorOpen(false);
        }}
      />
    </>
  );
}

function SnippetEditor({
  open, onClose, initial, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  initial: TemplateSnippet | null;
  onSubmit: (v: Pick<TemplateSnippet, "name" | "category" | "body" | "shortcut" | "is_shared">) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [category, setCategory] = useState(initial?.category || "general");
  const [body, setBody] = useState(initial?.body || "");
  const [shortcut, setShortcut] = useState(initial?.shortcut || "");
  const [isShared, setIsShared] = useState(initial?.is_shared || false);

  // Reset on open
  if (open && initial && initial.id !== (window as any).__snipLastId) {
    (window as any).__snipLastId = initial.id;
    setName(initial.name); setCategory(initial.category); setBody(initial.body);
    setShortcut(initial.shortcut || ""); setIsShared(initial.is_shared);
  } else if (open && !initial && (window as any).__snipLastId !== "new") {
    (window as any).__snipLastId = "new";
    setName(""); setCategory("general"); setBody(""); setShortcut(""); setIsShared(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { (window as any).__snipLastId = null; onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{initial ? "Edit snippet" : "New snippet"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SNIPPET_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Shortcut (optional)</Label>
              <Input value={shortcut} onChange={(e) => setShortcut(e.target.value)} placeholder="/intro" className="h-8 text-sm" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Body *</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="text-sm" />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Supports merge tags like {"{{contact.first_name}}"} and {"{{account.account_name}}"}.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Share with team</Label>
            <Switch checked={isShared} onCheckedChange={setIsShared} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!name.trim() || !body.trim()}
            onClick={() => onSubmit({ name: name.trim(), category, body: body.trim(), shortcut: shortcut.trim() || null, is_shared: isShared })}
          >
            {initial ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
