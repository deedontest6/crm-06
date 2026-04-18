import { ActionItemModal } from "@/components/ActionItemModal";
import { useActionItems, ActionItem, CreateActionItemInput } from "@/hooks/useActionItems";
import { useToast } from "@/hooks/use-toast";

interface KanbanActionItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionItem: ActionItem | null;
  defaultModuleId?: string;
  onSaved: () => void;
}

/**
 * Lazy wrapper around ActionItemModal — only mounts useActionItems()
 * (which fetches & subscribes to action_items) when the modal is actually open.
 * This avoids the fetch + realtime channel cost on every Kanban board render.
 */
export const KanbanActionItemModal = ({
  open,
  onOpenChange,
  actionItem,
  defaultModuleId,
  onSaved,
}: KanbanActionItemModalProps) => {
  const { toast } = useToast();
  const { createActionItem, updateActionItem } = useActionItems();

  const handleSave = async (data: CreateActionItemInput) => {
    try {
      if (actionItem) {
        await updateActionItem({ id: actionItem.id, ...data });
        toast({
          title: "Action item updated",
          description: "The action item has been updated successfully.",
        });
      } else {
        await createActionItem(data);
        toast({
          title: "Action item created",
          description: "The action item has been created successfully.",
        });
      }
      onSaved();
    } catch (error) {
      console.error("Error saving action item:", error);
      toast({
        title: "Error",
        description: "Failed to save action item.",
        variant: "destructive",
      });
    }
  };

  return (
    <ActionItemModal
      open={open}
      onOpenChange={onOpenChange}
      actionItem={actionItem}
      onSave={handleSave}
      defaultModuleType="deals"
      defaultModuleId={defaultModuleId}
    />
  );
};
