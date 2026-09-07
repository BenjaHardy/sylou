// Sylou's StarterKit configuration — shared by every editor (WritingEditor,
// the two creative mini-editors) and by the real-editor tests, so the tests
// exercise exactly the app's schema and keymaps.
//
// The TipTap v3 migration (2026-09) is behavior-preserving: v3's StarterKit
// bundles editing behaviors v2 did not have, and each is opted out here.
// Adopting any of them is a UX decision to take on its own terms, not a
// side effect of a version bump:
//   - link / underline: WritingEditor registers its own instances with its
//     own options (the mini-editors never had them);
//   - listKeymap: changes Backspace/Delete behavior inside lists;
//   - trailingNode: appends an empty paragraph after a trailing heading /
//     list / blockquote / code block — that would rewrite stored
//     writing_content on the first save (editor-html-roundtrip.test.ts pins
//     the v2 canon);
//   - Blockquote's new Backspace binding (lifts a paragraph out of a quote /
//     merges the paragraph after a quote into it);
//   - ListItem's bundled branching-Delete keymap: hoists a nested sublist as
//     a delete + re-insert, which the provenance tracker would relabel as
//     typed (it is a child extension of ListItem — listKeymap:false does not
//     reach it);
//   - OrderedList's plain-text paste plugin ("1. …" text becomes a list);
//   - CodeBlock exitOnArrowUp (a navigation key inserting a paragraph).
// Pinned by v2-keymap-parity.test.ts.
import StarterKit from "@tiptap/starter-kit";
import Blockquote from "@tiptap/extension-blockquote";
import { ListItem, OrderedList } from "@tiptap/extension-list";

/** v2 shortcut set: Mod-Shift-b only (v3 added a Backspace handler). */
export const BlockquoteV2 = Blockquote.extend({
  addKeyboardShortcuts() {
    return { "Mod-Shift-b": () => this.editor.commands.toggleBlockquote() };
  },
});

/** v2 ListItem: without the branching-Delete keymap v3 bundles via addExtensions. */
export const ListItemV2 = ListItem.extend({
  addExtensions() {
    return [];
  },
});

/** v2 OrderedList: without the plain-text paste-to-list plugin. */
export const OrderedListV2 = OrderedList.extend({
  addProseMirrorPlugins() {
    return [];
  },
});

type StarterKitConfig = NonNullable<Parameters<typeof StarterKit.configure>[0]>;

export function sylouStarterKit(options: Pick<StarterKitConfig, "heading"> = {}) {
  return [
    StarterKit.configure({
      ...options,
      link: false,
      underline: false,
      listKeymap: false,
      trailingNode: false,
      blockquote: false,
      listItem: false,
      orderedList: false,
      codeBlock: { exitOnArrowUp: false },
    }),
    BlockquoteV2,
    ListItemV2,
    OrderedListV2,
  ];
}
