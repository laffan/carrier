<script lang="ts">
  import { onMount } from "svelte";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { syntaxHighlighting } from "@codemirror/language";
  import { EditorSelection, EditorState, Prec } from "@codemirror/state";
  import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
  import { editorTheme, livePreview, markdownHighlight } from "../lib/editor/livePreview";

  interface Props {
    value: string;
    onchange: (value: string) => void;
    onsend?: () => void;
    placeholder?: string;
    autofocus?: boolean;
  }
  let { value, onchange, onsend, placeholder = "", autofocus = false }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  /** Wraps the selection (or the word at the cursor) in Markdown markers. */
  function wrap(before: string, after = before) {
    return (v: EditorView) => {
      v.dispatch(
        v.state.changeByRange((range) => {
          let { from, to } = range;
          if (from === to) {
            const word = v.state.wordAt(from);
            if (word) ({ from, to } = word);
          }
          const text = v.state.sliceDoc(from, to);
          const insert = before + text + after;
          const cursor = from === to ? from + before.length : from + insert.length;
          return { changes: { from, to, insert }, range: EditorSelection.cursor(cursor) };
        }),
      );
      return true;
    };
  }

  function link(v: EditorView) {
    v.dispatch(
      v.state.changeByRange((range) => {
        const text = v.state.sliceDoc(range.from, range.to) || "link";
        const insert = `[${text}](https://)`;
        const urlStart = range.from + text.length + 3;
        return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlStart, urlStart + 8) };
      }),
    );
    return true;
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", run: () => (onsend?.(), true) },
              { key: "Mod-b", run: wrap("**") },
              { key: "Mod-i", run: wrap("*") },
              { key: "Mod-k", run: link },
              { key: "Mod-Shift-x", run: wrap("~~") },
              { key: "Mod-e", run: wrap("`") },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownHighlight),
          livePreview,
          editorTheme,
          EditorView.lineWrapping,
          placeholderExt(placeholder),
          EditorView.contentAttributes.of({
            spellcheck: "true",
            autocorrect: "on",
            autocapitalize: "sentences",
            "aria-label": "Message body",
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onchange(u.state.doc.toString());
          }),
        ],
      }),
    });
    if (autofocus) {
      view.focus();
      view.dispatch({ selection: { anchor: 0 } });
    }
    return () => view?.destroy();
  });

  // Apply changes made outside the editor (e.g. restoring a draft).
  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    }
  });

  export function focus() {
    view?.focus();
  }
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    min-height: 180px;
  }
  .editor :global(.cm-editor) {
    min-height: 180px;
  }
</style>
