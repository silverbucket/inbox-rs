<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
  import { Markdown } from 'tiptap-markdown';
  import Placeholder from '@tiptap/extension-placeholder';
  import { common, createLowlight } from 'lowlight';
  import 'highlight.js/styles/github-dark.min.css';
  import { CodeBlockAutoIndent } from '../lib/tiptap-code-indent';

  let {
    value = $bindable(''),
    placeholder = 'Write your note...',
  }: {
    value: string;
    placeholder?: string;
  } = $props();

  // Bound via `bind:this` below — populated after mount, so the type is
  // optional and `onMount` returns early if the bind hasn't resolved yet
  // (it always has by the time onMount fires, but keeping the type honest
  // avoids the non-null assertion hack).
  let editorElement = $state<HTMLDivElement>();
  let editor: Editor | null = null;

  const lowlight = createLowlight(common);

  onMount(() => {
    if (!editorElement) return;
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
        }),
        CodeBlockLowlight.configure({
          lowlight,
          enableTabIndentation: true,
          tabSize: 2,
        }),
        Markdown.configure({
          html: false,
          breaks: true,
          tightLists: true,
          transformPastedText: true,
        }),
        Placeholder.configure({
          placeholder,
        }),
        CodeBlockAutoIndent,
      ],
      content: value,
      onUpdate: ({ editor: e }) => {
        value = e.storage.markdown.getMarkdown();
      },
      editorProps: {
        attributes: {
          class: 'tiptap-editor',
        },
      },
    });
  });

  onDestroy(() => {
    editor?.destroy();
  });

  // Keep the visual editor in sync with external markdown updates.
  $effect(() => {
    if (!editor) {
      return;
    }

    const currentMd = editor.storage.markdown.getMarkdown();
    if (currentMd !== value) {
      editor.commands.setContent(value);
    }
  });
</script>

<div class="editor-container">
  <div class="tiptap-wrap" bind:this={editorElement}></div>
</div>

<style>
  .editor-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .tiptap-wrap {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow-y: auto;
  }

  .tiptap-wrap :global(.tiptap-editor) {
    flex: 1;
    padding: 0.75rem;
    outline: none;
    font-size: 0.9rem;
    line-height: 1.6;
    color: var(--text);
    min-height: 100%;
  }

  .tiptap-wrap:focus-within {
    border-color: var(--accent);
  }

  .tiptap-wrap :global(.tiptap-editor p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    color: var(--text-muted);
    opacity: 0.5;
    pointer-events: none;
    float: left;
    height: 0;
  }

  /* Headings */
  .tiptap-wrap :global(h1) { font-size: 1.3rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
  .tiptap-wrap :global(h2) { font-size: 1.15rem; font-weight: 600; margin: 0.6rem 0 0.35rem; }
  .tiptap-wrap :global(h3) { font-size: 1.05rem; font-weight: 600; margin: 0.5rem 0 0.3rem; }
  .tiptap-wrap :global(h4),
  .tiptap-wrap :global(h5),
  .tiptap-wrap :global(h6) { font-size: 0.95rem; font-weight: 600; margin: 0.4rem 0 0.25rem; }

  /* Lists */
  .tiptap-wrap :global(ul),
  .tiptap-wrap :global(ol) {
    padding-left: 1.5rem;
    margin: 0.25rem 0;
  }
  .tiptap-wrap :global(ul) { list-style: disc; }
  .tiptap-wrap :global(ol) { list-style: decimal; }
  .tiptap-wrap :global(li) { margin-bottom: 0.1rem; }
  .tiptap-wrap :global(li p) { margin: 0; }

  /* Blockquote */
  .tiptap-wrap :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0.4rem 0;
    color: var(--text-muted);
  }
  .tiptap-wrap :global(blockquote p) { margin: 0; }

  /* Inline code */
  .tiptap-wrap :global(code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }

  /* Code blocks */
  .tiptap-wrap :global(pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0.4rem 0;
    overflow-x: auto;
  }
  .tiptap-wrap :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }

  /* Horizontal rule */
  .tiptap-wrap :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }

  /* Strong & em */
  .tiptap-wrap :global(strong) { font-weight: 600; }
  .tiptap-wrap :global(em) { font-style: italic; }

  /* Paragraph spacing */
  .tiptap-wrap :global(p) { margin: 0 0 0.4rem; }
  .tiptap-wrap :global(p:last-child) { margin-bottom: 0; }
</style>
