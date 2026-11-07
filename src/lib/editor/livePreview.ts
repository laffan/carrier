/**
 * Live Markdown preview for CodeMirror 6: formatting is shown in place and
 * the syntax characters (**, _, `, #, [](url), >) are hidden except on the
 * element the cursor is in, so they can still be edited.
 */
import { syntaxTree } from "@codemirror/language";
import { HighlightStyle } from "@codemirror/language";
import { RangeSet, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

class BulletWidget extends WidgetType {
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-bullet";
    s.textContent = "•";
    return s;
  }
  eq() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-md-hr";
    return s;
  }
  eq() {
    return true;
  }
}

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const inlineCode = Decoration.mark({ class: "cm-md-code" });
const quoteLine = Decoration.line({ class: "cm-md-quote" });
const codeLine = Decoration.line({ class: "cm-md-codeblock" });

const INLINE = new Set(["Emphasis", "StrongEmphasis", "InlineCode", "Strikethrough"]);
const INLINE_MARKS = new Set(["EmphasisMark", "CodeMark", "StrikethroughMark"]);

function build(view: EditorView): DecorationSet {
  const state: EditorState = view.state;
  const ranges = state.selection.ranges;
  const focused = view.hasFocus;
  const touches = (from: number, to: number) => focused && ranges.some((r) => r.from <= to && r.to >= from);
  const activeLine = (pos: number) => {
    const line = state.doc.lineAt(pos);
    return touches(line.from, line.to);
  };
  const out: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;

        if (INLINE.has(name)) {
          if (name === "InlineCode") out.push(inlineCode.range(node.from, node.to));
          if (!touches(node.from, node.to)) {
            const c = node.node.cursor();
            if (c.firstChild()) {
              do {
                if (INLINE_MARKS.has(c.name) && c.to > c.from) out.push(hidden.range(c.from, c.to));
              } while (c.nextSibling());
            }
          }
          return;
        }

        if (/^ATXHeading\d$/.test(name)) {
          if (!activeLine(node.from)) {
            const c = node.node.cursor();
            if (c.firstChild() && c.name === "HeaderMark") {
              let end = c.to;
              if (state.doc.sliceString(end, end + 1) === " ") end++;
              out.push(hidden.range(c.from, end));
            }
          }
          return;
        }

        if (name === "Link" || name === "Image") {
          if (!touches(node.from, node.to)) {
            const c = node.node.cursor();
            if (c.firstChild()) {
              do {
                if ((c.name === "LinkMark" || c.name === "URL" || c.name === "LinkTitle") && c.to > c.from) {
                  out.push(hidden.range(c.from, c.to));
                }
              } while (c.nextSibling());
            }
          }
          return false;
        }

        if (name === "ListMark") {
          const parent = node.node.parent?.parent;
          const text = state.doc.sliceString(node.from, node.to);
          if (parent?.name === "BulletList" && /^[-*+]$/.test(text) && !activeLine(node.from)) {
            out.push(bullet.range(node.from, node.to));
          }
          return;
        }

        if (name === "Blockquote") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            out.push(quoteLine.range(line.from));
            pos = line.to + 1;
          }
          return;
        }

        if (name === "QuoteMark") {
          if (!activeLine(node.from)) {
            let end = node.to;
            if (state.doc.sliceString(end, end + 1) === " ") end++;
            out.push(hidden.range(node.from, end));
          }
          return;
        }

        if (name === "FencedCode" || name === "CodeBlock") {
          for (let pos = node.from; pos <= node.to; ) {
            const line = state.doc.lineAt(pos);
            out.push(codeLine.range(line.from));
            pos = line.to + 1;
          }
          return false;
        }

        if (name === "HorizontalRule" && !activeLine(node.from)) {
          out.push(rule.range(node.from, node.to));
        }
      },
    });
  }
  return RangeSet.of(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Text styles for Markdown elements. */
export const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.45em", fontWeight: "600", lineHeight: "1.3" },
  { tag: t.heading2, fontSize: "1.25em", fontWeight: "600" },
  { tag: t.heading3, fontSize: "1.1em", fontWeight: "600" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600" },
  { tag: t.strong, fontWeight: "650" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: "2px" },
  { tag: t.url, color: "var(--text-3)" },
  { tag: t.quote, color: "var(--text-2)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.9em" },
  { tag: t.processingInstruction, color: "var(--text-3)" },
  { tag: t.contentSeparator, color: "var(--text-3)" },
]);

export const editorTheme = EditorView.theme({
  "&": { fontSize: "15.5px", color: "var(--text)", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.55", overflow: "visible" },
  ".cm-content": { padding: "16px 0 8px", caretColor: "var(--text)", minHeight: "180px" },
  ".cm-line": { padding: "0 20px" },
  ".cm-cursor": { borderLeftColor: "var(--text)", borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft) !important" },
  ".cm-placeholder": { color: "var(--text-3)" },
  ".cm-md-code": { backgroundColor: "var(--bg-3)", borderRadius: "4px", padding: "1px 3px" },
  ".cm-md-bullet": { color: "var(--text-2)", display: "inline-block", width: "0.7em" },
  ".cm-md-quote": { borderLeft: "3px solid var(--line-2)", paddingLeft: "14px !important", marginLeft: "20px", color: "var(--text-2)" },
  ".cm-md-codeblock": { fontFamily: "var(--mono)", fontSize: "13.5px", backgroundColor: "var(--bg-2)" },
  ".cm-md-hr": { display: "inline-block", width: "100%", borderTop: "1px solid var(--line-2)", verticalAlign: "middle" },
});
