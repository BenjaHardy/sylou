import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Pagination extension
 *
 * Adds visual page breaks to the editor when enabled via
 * `editor.commands.setPaginationEnabled(true)`. Pure decorations — does not
 * mutate the document, so undo/redo, provenance, save, and export pipelines
 * are unaffected.
 *
 * Strategy: walk the top-level block DOM children of the PM root, measure
 * their offsetTop/offsetHeight, and insert a non-editable spacer widget
 * decoration before any block that would cross a page boundary. Each spacer
 * carries the upcoming page-number label in its right margin.
 */
const paginationKey = new PluginKey("pagination");

declare module "@tiptap/core" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Commands<ReturnType> {
    pagination: {
      setPaginationEnabled: (enabled: boolean) => ReturnType;
    };
  }
}

export const Pagination = Extension.create({
  name: "pagination",

  addStorage() {
    return { enabled: false as boolean };
  },

  addCommands() {
    return {
      setPaginationEnabled:
        (enabled: boolean) =>
        ({ editor }) => {
          editor.storage.pagination.enabled = enabled;
          // Trigger a no-op transaction so the plugin view's update handler runs.
          editor.view.dispatch(editor.state.tr.setMeta(paginationKey, { ping: true }));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    // The plugin's view() closure below needs the extension instance;
    // `this` doesn't resolve to it there.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const ext = this;

    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(paginationKey);
            if (meta?.decorations) return meta.decorations as DecorationSet;
            if (meta?.clear) return DecorationSet.empty;
            if (tr.docChanged) return old.map(tr.mapping, tr.doc);
            return old;
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state) as DecorationSet | undefined;
          },
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let raf = 0;
          let lastEnabled = ext.storage.enabled;

          const recompute = () => {
            const root = view.dom as HTMLElement;
            if (!ext.storage.enabled) {
              view.dispatch(view.state.tr.setMeta(paginationKey, { clear: true }));
              return;
            }

            const sheet = root.closest(".editor-page-sheet") as HTMLElement | null;
            const cs = sheet ? getComputedStyle(sheet) : null;
            const readVar = (name: string, fallback: number) => {
              const raw = cs?.getPropertyValue(name).trim();
              if (!raw) return fallback;
              // Resolve cm/px/etc via a probe element.
              const probe = document.createElement("div");
              probe.style.position = "absolute";
              probe.style.visibility = "hidden";
              probe.style.height = raw;
              (sheet ?? document.body).appendChild(probe);
              const px = probe.getBoundingClientRect().height;
              probe.remove();
              return px || fallback;
            };

            const pageContentHeight = readVar("--page-content-height", 934);
            const pageGap = readVar("--page-gap", 56);
            if (pageContentHeight <= 0) return;

            const blocks = Array.from(root.children) as HTMLElement[];
            const decos: Decoration[] = [];
            let pageBottom = pageContentHeight;
            let pageIndex = 1;

            for (const block of blocks) {
              const top = block.offsetTop;
              const height = block.offsetHeight;
              const bottom = top + height;

              if (bottom > pageBottom && top < pageBottom) {
                const spacerHeight = pageBottom - top + pageGap;
                let pos: number;
                try {
                  pos = view.posAtDOM(block, 0);
                } catch {
                  continue;
                }
                const nextPage = pageIndex + 1;
                decos.push(
                  Decoration.widget(
                    pos,
                    () => {
                      const el = document.createElement("div");
                      el.className = "pm-page-spacer";
                      el.style.height = `${spacerHeight}px`;
                      const label = document.createElement("span");
                      label.className = "pm-page-number";
                      label.textContent = `Page ${nextPage}`;
                      el.appendChild(label);
                      return el;
                    },
                    { side: -1, key: `pg-${nextPage}`, ignoreSelection: true },
                  ),
                );
                pageIndex = nextPage;
                pageBottom += pageContentHeight + pageGap;
              }

              // Block taller than a page: skip ahead so subsequent blocks paginate correctly.
              while (bottom > pageBottom) {
                pageBottom += pageContentHeight + pageGap;
              }
            }

            const next = DecorationSet.create(view.state.doc, decos);
            view.dispatch(view.state.tr.setMeta(paginationKey, { decorations: next }));
          };

          const schedule = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              if (raf) cancelAnimationFrame(raf);
              raf = requestAnimationFrame(recompute);
            }, 150);
          };

          const ro = new ResizeObserver(schedule);
          ro.observe(view.dom);

          // Initial pass.
          schedule();

          return {
            update(v, prevState) {
              if (ext.storage.enabled !== lastEnabled) {
                lastEnabled = ext.storage.enabled;
                schedule();
                return;
              }
              if (!ext.storage.enabled) return;
              if (prevState.doc !== v.state.doc) schedule();
            },
            destroy() {
              ro.disconnect();
              if (timer) clearTimeout(timer);
              if (raf) cancelAnimationFrame(raf);
            },
          };
        },
      }),
    ];
  },
});
