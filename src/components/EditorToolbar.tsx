import { useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Editor = any;
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Bold, Italic, Underline, Strikethrough,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code2, Link2, Minus,
  Undo2, Redo2,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Search, X, ChevronDown, Palette,
  FileDown, Lock, FileText,
} from "lucide-react";

interface Props {
  editor: Editor;
  onExportPDF?: () => void;
  onExportDOCX?: () => void;
  onExportJSON?: () => void;
  subscriptionTier?: string;
  pageView?: boolean;
  onTogglePageView?: () => void;
}

const FONT_SIZES = ["10", "12", "14", "16", "18", "20", "24", "28", "32"];

const PRESET_COLORS = [
  "#000000", "#434343", "#666666", "#999999",
  "#B7B7B7", "#D9D9D9", "#EF4444", "#F97316",
  "#EAB308", "#22C55E", "#3B82F6", "#8B5CF6",
  "#EC4899", "#14B8A6", "#6366F1", "#A855F7",
];

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

function FontSizeDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const currentSize = editor.getAttributes("textStyle")?.fontSize?.replace("px", "") || "16";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Font size"
          className="h-8 px-2 flex items-center gap-0.5 rounded-md text-xs font-medium hover:bg-accent transition-colors"
        >
          {currentSize}
          <ChevronDown size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-24 p-1" align="start">
        {FONT_SIZES.map((size) => (
          <button
            key={size}
            onClick={() => {
              editor.chain().focus().setFontSize(`${size}px`).run();
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors ${
              currentSize === size ? "bg-accent font-medium" : ""
            }`}
          >
            {size}
          </button>
        ))}
        <button
          onClick={() => {
            editor.chain().focus().unsetFontSize().run();
            setOpen(false);
          }}
          className="w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent transition-colors text-muted-foreground"
        >
          Default
        </button>
      </PopoverContent>
    </Popover>
  );
}

function FontColorPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const currentColor = editor.getAttributes("textStyle")?.color || "#000000";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          title="Font color"
          className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors"
        >
          <div className="flex flex-col items-center gap-0.5">
            <Palette size={14} />
            <div
              className="h-1 w-4 rounded-sm"
              style={{ backgroundColor: currentColor }}
            />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-3" align="start">
        <div className="grid grid-cols-4 gap-1.5 mb-3">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => {
                editor.chain().focus().setColor(color).run();
                setOpen(false);
              }}
              className="h-7 w-7 rounded-md border border-border hover:scale-110 transition-transform"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={currentColor}
            onChange={(e) => {
              editor.chain().focus().setColor(e.target.value).run();
            }}
            className="h-7 w-7 rounded cursor-pointer border-0 p-0"
            title="Custom color"
          />
          <span className="text-xs text-muted-foreground">Custom</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs px-2 ml-auto"
            onClick={() => {
              editor.chain().focus().unsetColor().run();
              setOpen(false);
            }}
          >
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EditorToolbar({ editor, onExportPDF, onExportDOCX, onExportJSON, subscriptionTier = "free", pageView = false, onTogglePageView }: Props) {
  const isFree = subscriptionTier === "free";
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const iconSize = 15;

  const handleFind = () => {
    if (!findText) return;
    if ((window as any).find) {
      (window as any).find(findText, false, false, true);
    }
  };

  const handleReplace = () => {
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
    <div className="border-b border-border bg-[hsl(var(--ethos-surface))] shrink-0 print:hidden">
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

        {/* Font size & color */}
        <FontSizeDropdown editor={editor} />
        <FontColorPicker editor={editor} />

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

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Page view toggle */}
        {onTogglePageView && (
          <ToolbarToggle
            pressed={pageView}
            onPressedChange={onTogglePageView}
            title="Page view"
          >
            <FileText size={iconSize} />
          </ToolbarToggle>
        )}

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Export */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="Export"
              className="h-8 w-8 flex items-center justify-center rounded-md text-primary hover:bg-primary/10 transition-colors"
            >
              <FileDown size={iconSize} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExportPDF}>
              Export Writing as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportDOCX} className="flex items-center gap-2">
              Export Writing as DOCX
              {isFree && <Lock size={12} className="text-muted-foreground" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportJSON} className="flex items-center gap-2">
              Export Project as JSON
              {isFree && <Lock size={12} className="text-muted-foreground" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
