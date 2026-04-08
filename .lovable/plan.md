

## Plan: Keep Chat Panel Visible on Creative Tabs

### Problem

The chat panel lives inside the "writing" tab's `ResizablePanelGroup`. When switching to creative tabs (World-Building, Characters, Timeline), the writing div is hidden via CSS and the creative tool divs render without a chat panel.

### Solution

Lift the `ResizablePanelGroup` (editor+chat) out so it wraps all tab content. The left resizable panel becomes a container that swaps between writing editor and creative tools based on `activeCreativeTab`. The right panel (chat) stays visible across all tabs.

### Layout restructure in `ProjectContentArea.tsx`

**Current structure:**
```text
<div (editor layer)>
  <toolbar>
  <creative tabs bar>
  
  <div display=writing>         ← contains ResizablePanelGroup
    <ResizablePanelGroup>
      <Panel: editor/>
      <Handle/>
      <Panel: chat/>
    </ResizablePanelGroup>
  </div>
  
  <CreativeAIContextProvider>
    <div display=worldbuilding>  ← no chat
    <div display=characters>     ← no chat
    <div display=timeline>       ← no chat
  </CreativeAIContextProvider>
</div>
```

**New structure:**
```text
<div (editor layer)>
  <toolbar>
  <creative tabs bar>
  
  <ResizablePanelGroup>          ← always visible
    <Panel: left content>
      <div display=writing>      ← editor only
      <CreativeAIContextProvider>
        <div display=worldbuilding>
        <div display=characters>
        <div display=timeline>
      </CreativeAIContextProvider>
    </Panel>
    <Handle/>
    <Panel: chat/>               ← always visible
  </ResizablePanelGroup>
</div>
```

The `CreativeAIContextProvider` wrapping moves inside the left panel. The chat panel stays mounted and visible regardless of active tab. The CSS-hide (`display: none`) pattern is preserved for all tabs so state is not lost.

### World-Building column widths

Currently `w-[220px]` (categories) and `w-[200px]` (notes list) are fixed widths totalling 420px, which may crowd the editor area when chat is also visible.

Make both columns resizable using the existing `ResizablePanelGroup`:
- Replace the fixed-width divs with a nested horizontal `ResizablePanelGroup` containing 3 panels: categories | notes list | note editor
- Categories panel: `defaultSize={15}`, `minSize={10}` (shrinks to ~100px)
- Notes list panel: `defaultSize={15}`, `minSize={10}`
- Note editor panel: `defaultSize={70}` (takes remaining space)
- Add `ResizableHandle` between each

This lets users drag the column widths narrower when space is tight, similar to the project sidebar behavior.

### Characters & Timeline

These already use flexible layouts (draggable canvas for Characters, centered scrollable list for Timeline). They should work fine with the reduced width from the chat panel being visible. No layout changes needed — they'll just fill whatever space the left panel provides.

### Files Changed

| File | Change |
|------|--------|
| `src/components/ProjectContentArea.tsx` | Restructure: lift `ResizablePanelGroup` to wrap all tabs; move creative tool divs inside left panel |
| `src/components/creative-tools/WorldBuildingNotes.tsx` | Replace fixed-width columns with nested `ResizablePanelGroup` for categories + notes list + editor |

