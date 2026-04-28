import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface TemplateSnippet {
  id: string;
  name: string;
  category: string;
  body: string;
  shortcut: string | null;
  is_shared: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const SNIPPET_CATEGORIES = [
  "greeting",
  "intro",
  "value-prop",
  "cta",
  "sign-off",
  "follow-up",
  "general",
] as const;

export function useTemplateSnippets() {
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["template-snippets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_template_snippets")
        .select("*")
        .order("category", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as TemplateSnippet[];
    },
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: async (input: Omit<TemplateSnippet, "id" | "created_at" | "updated_at" | "created_by">) => {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("campaign_template_snippets")
        .insert({ ...input, created_by: u.user?.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["template-snippets"] });
      toast({ title: "Snippet saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<TemplateSnippet> & { id: string }) => {
      const { error } = await supabase.from("campaign_template_snippets").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["template-snippets"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("campaign_template_snippets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["template-snippets"] });
      toast({ title: "Snippet deleted" });
    },
  });

  return { snippets: list.data || [], isLoading: list.isLoading, create, update, remove };
}
