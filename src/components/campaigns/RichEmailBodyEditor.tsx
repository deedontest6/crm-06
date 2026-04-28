import { useEffect, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Button } from "@/components/ui/button";
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Unlink, Undo2, Redo2 } from "lucide-react";

/** Heuristic: does the body already contain block-level HTML? */
export function looksLikeHtml(text: string): boolean {
  if (!text) return false;
  return /<\/?[a-z][\s\S]*?>/i.test(text);
}

/** Convert plain text with paragraph/line breaks to HTML so Tiptap renders
 * formatting correctly. Blank lines become <p>, single newlines become <br>. */
export function plainTextToHtml(text: string): string {
  if (!text) return "";
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return blocks
    .map((block) => `<p>${escape(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** True when a TipTap-generated HTML string is effectively empty (eg `<p></p>`). */
export function isEditorHtmlEmpty(html: string): boolean {
  if (!html) return true;
  const stripped = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
  return stripped.length === 0;
}

interface RichEmailBodyEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeightPx?: number;
}

export function RichEmailBodyEditor({
  value,
  onChange,
  placeholder = "Hi {first_name},\n\nI noticed {company_name} is focused on...",
  minHeightPx = 240,
}: RichEmailBodyEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      LinkExtension.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
      Placeholder.configure({ placeholder }),
    ],
    content: looksLikeHtml(value) ? value : plainTextToHtml(value),
    editorProps: {
      attributes: {
        class: "px-3 py-2 text-sm leading-6 outline-none max-w-none",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    const incoming = looksLikeHtml(value) ? value : plainTextToHtml(value);
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming || "", { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl || "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const toolbarButton = (label: string, icon: ReactNode, onClick: () => void, active = false, disabled = false) => (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="h-8 w-8"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </Button>
  );

  return (
    <div className="rounded-md border border-input bg-background overflow-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/40 p-1.5">
        {toolbarButton("Bold", <Bold className="h-4 w-4" />, () => editor?.chain().focus().toggleBold().run(), !!editor?.isActive("bold"), !editor)}
        {toolbarButton("Italic", <Italic className="h-4 w-4" />, () => editor?.chain().focus().toggleItalic().run(), !!editor?.isActive("italic"), !editor)}
        {toolbarButton("Bullet list", <List className="h-4 w-4" />, () => editor?.chain().focus().toggleBulletList().run(), !!editor?.isActive("bulletList"), !editor)}
        {toolbarButton("Numbered list", <ListOrdered className="h-4 w-4" />, () => editor?.chain().focus().toggleOrderedList().run(), !!editor?.isActive("orderedList"), !editor)}
        <div className="mx-1 h-5 w-px bg-border" />
        {toolbarButton("Add link", <LinkIcon className="h-4 w-4" />, setLink, !!editor?.isActive("link"), !editor)}
        {toolbarButton("Remove link", <Unlink className="h-4 w-4" />, () => editor?.chain().focus().unsetLink().run(), false, !editor?.isActive("link"))}
        <div className="mx-1 h-5 w-px bg-border" />
        {toolbarButton("Undo", <Undo2 className="h-4 w-4" />, () => editor?.chain().focus().undo().run(), false, !editor?.can().undo())}
        {toolbarButton("Redo", <Redo2 className="h-4 w-4" />, () => editor?.chain().focus().redo().run(), false, !editor?.can().redo())}
      </div>
      <EditorContent editor={editor} className="rich-email-editor" />
      <style>{`
        .rich-email-editor .ProseMirror { min-height: ${minHeightPx}px; }
        .rich-email-editor .ProseMirror p { margin: 0 0 0.85em 0; }
        .rich-email-editor .ProseMirror p:last-child { margin-bottom: 0; }
        .rich-email-editor .ProseMirror ul,
        .rich-email-editor .ProseMirror ol { margin: 0 0 0.85em 1.25em; padding-left: 1rem; }
        .rich-email-editor .ProseMirror ul { list-style: disc; }
        .rich-email-editor .ProseMirror ol { list-style: decimal; }
        .rich-email-editor .ProseMirror li { margin: 0.15em 0; }
        .rich-email-editor .ProseMirror a { color: hsl(var(--primary)); text-decoration: underline; }
        .rich-email-editor .ProseMirror strong { font-weight: 600; }
        .rich-email-editor .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          float: left;
          height: 0;
          pointer-events: none;
          white-space: pre-line;
        }
      `}</style>
    </div>
  );
}
