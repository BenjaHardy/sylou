import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code2, Link2, Minus,
  Undo2, Redo2,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Search, X,
} from "lucide-react";

interface Props {
  editor: Editor;
}

function ToolbarToggle({
  pressed,
  onPressedChange,
  children,
  title,
}: {
  pressed: boolean;
  onPressedChange: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <Toggle
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      title={title}
      className="h-8 w-8 p-0 data-[state=on]:bg-accent"
    >
      {children}
    </Toggle>
  );
}

export function EditorToolbar({ editor }: Props) {
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const iconSize = 15;

  const handleFind = () => {
    if (!findText) return;
    // @ts-ignore - window.find is non-standard but widely supported
    if ((window as any).find) {
      (window as any).find(findText, false, false, true);
    }
  };

  const handleReplace = () => {
    // Simple replace via execCommand for selected text
    const selection = window.getSelection();
    if (selection && selection.toString() === findText) {
      editor.commands.insertContent(replaceText);
      handleFind();
    } else {
      handleFind();
    }
  };

  const handleReplaceAll = () => {
    const html = editor.getHTML();
    const replaced = html.split(findText).join(replaceText);
    editor.commands.setContent(replaced);
  };

  const setLink = () => {
    if (linkUrl) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: linkUrl })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setLinkUrl("");
  };

  return (
    <div className="border-b border-border bg-muted/30 shrink-0">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
        {/* Text formatting */}
        <ToolbarToggle pressed={editor.isActive("bold")} onPressedChange={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <Bold size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("italic")} onPressedChange={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <Italic size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("underline")} onPressedChange={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
          <Underline size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("strike")} onPressedChange={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <Strikethrough size={iconSize} />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Headings */}
        <ToolbarToggle pressed={editor.isActive("heading", { level: 1 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1">
          <Heading1 size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("heading", { level: 2 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
          <Heading2 size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("heading", { level: 3 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
          <Heading3 size={iconSize} />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Lists & blocks */}
        <ToolbarToggle pressed={editor.isActive("bulletList")} onPressedChange={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <List size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("orderedList")} onPressedChange={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <ListOrdered size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("blockquote")} onPressedChange={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
          <Quote size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive("codeBlock")} onPressedChange={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
          <Code2 size={iconSize} />
        </ToolbarToggle>

        {/* Link */}
        <Popover>
          <PopoverTrigger asChild>
            <Toggle
              size="sm"
              pressed={editor.isActive("link")}
              title="Link"
              className="h-8 w-8 p-0 data-[state=on]:bg-accent"
            >
              <Link2 size={iconSize} />
            </Toggle>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="start">
            <div className="flex gap-2">
              <Input
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setLink()}
                className="h-8 text-sm"
              />
              <Button size="sm" className="h-8" onClick={setLink}>
                Set
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={() => editor.chain().focus().setHorizontalRule().run()}
          title="Horizontal rule"
          className="h-8 w-8 p-0"
        >
          <Minus size={iconSize} />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Alignment */}
        <ToolbarToggle pressed={editor.isActive({ textAlign: "left" })} onPressedChange={() => editor.chain().focus().setTextAlign("left").run()} title="Align left">
          <AlignLeft size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive({ textAlign: "center" })} onPressedChange={() => editor.chain().focus().setTextAlign("center").run()} title="Align center">
          <AlignCenter size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive({ textAlign: "right" })} onPressedChange={() => editor.chain().focus().setTextAlign("right").run()} title="Align right">
          <AlignRight size={iconSize} />
        </ToolbarToggle>
        <ToolbarToggle pressed={editor.isActive({ textAlign: "justify" })} onPressedChange={() => editor.chain().focus().setTextAlign("justify").run()} title="Justify">
          <AlignJustify size={iconSize} />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Undo / Redo */}
        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
          className="h-8 w-8 p-0"
        >
          <Undo2 size={iconSize} />
        </Toggle>
        <Toggle
          size="sm"
          pressed={false}
          onPressedChange={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
          className="h-8 w-8 p-0"
        >
          <Redo2 size={iconSize} />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Find & Replace */}
        <Toggle
          size="sm"
          pressed={findOpen}
          onPressedChange={() => setFindOpen(!findOpen)}
          title="Find & Replace"
          className="h-8 w-8 p-0"
        >
          <Search size={iconSize} />
        </Toggle>
      </div>

      {findOpen && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border bg-muted/20">
          <Input
            placeholder="Find…"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleFind()}
            className="h-7 text-xs w-40"
          />
          <Input
            placeholder="Replace…"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleReplace()}
            className="h-7 text-xs w-40"
          />
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleFind}>
            Find
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleReplace}>
            Replace
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={handleReplaceAll}>
            All
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setFindOpen(false)}>
            <X size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
