<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
  import { Markdown } from 'tiptap-markdown';
  import { common, createLowlight } from 'lowlight';
  import 'highlight.js/styles/github-dark.min.css';

  let {
    value = $bindable(''),
    mode = $bindable<'visual' | 'write' | 'preview'>('visual'),
    placeholder = 'Write your note...',
  }: {
    value: string;
    mode: 'visual' | 'write' | 'preview';
    placeholder?: string;
  } = $props();

  let editorElement = $state<HTMLDivElement>(undefined!);
  let editor: Editor | null = null;
  let previewHtml = $state('');

  const lowlight = createLowlight(common);

  onMount(() => {
    editor = new Editor({
      element: editorElement,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
        }),
        CodeBlockLowlight.configure({
          lowlight,
        }),
        Markdown.configure({
          html: false,
          breaks: true,
          tightLists: true,
          transformPastedText: true,
        }),
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

  // Sync mode changes - when switching to visual, update editor content
  $effect(() => {
    if (mode === 'visual' && editor) {
      const currentMd = editor.storage.markdown.getMarkdown();
      if (currentMd !== value) {
        editor.commands.setContent(value);
      }
    }
    if (mode === 'preview') {
      import('../lib/markdown')
        .then(({ renderMarkdown }) => renderMarkdown(value))
        .then((html) => { previewHtml = html; })
        .catch(() => { previewHtml = ''; });
    }
  });

  function handleTextareaInput(e: Event) {
    value = (e.target as HTMLTextAreaElement).value;
  }
</script>

<div class="editor-container">
  <div class="tiptap-wrap" class:hidden={mode !== 'visual'} bind:this={editorElement}></div>
  {#if mode === 'write'}
    <textarea
      class="raw-textarea"
      {placeholder}
      oninput={handleTextareaInput}
      value={value}
    ></textarea>
  {:else if mode === 'preview'}
    <div class="preview-wrap markdown-body">
      {#if previewHtml}
        {@html previewHtml}
      {:else}
        <span class="preview-empty">Nothing to preview</span>
      {/if}
    </div>
  {/if}
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

  .tiptap-wrap.hidden {
    display: none;
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

  /* Raw textarea mode */
  .raw-textarea {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.85rem;
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    color: var(--text);
    resize: none;
    line-height: 1.6;
    min-height: 0;
  }
  .raw-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* Preview mode */
  .preview-wrap {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    overflow-y: auto;
    min-height: 0;
  }

  .preview-empty {
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.85rem;
  }

  /* Markdown body styles for preview */
  .markdown-body {
    font-size: 0.9rem;
    color: var(--text);
    line-height: 1.6;
    word-break: break-word;
  }
  .markdown-body :global(h1) { font-size: 1.3rem; font-weight: 600; margin: 0.75rem 0 0.4rem; }
  .markdown-body :global(h2) { font-size: 1.15rem; font-weight: 600; margin: 0.6rem 0 0.35rem; }
  .markdown-body :global(h3) { font-size: 1.05rem; font-weight: 600; margin: 0.5rem 0 0.3rem; }
  .markdown-body :global(p) { margin: 0 0 0.5rem; }
  .markdown-body :global(p:last-child) { margin-bottom: 0; }
  .markdown-body :global(ul),
  .markdown-body :global(ol) { padding-left: 1.5rem; margin: 0 0 0.5rem; }
  .markdown-body :global(ul) { list-style: disc; }
  .markdown-body :global(ol) { list-style: decimal; }
  .markdown-body :global(li) { margin-bottom: 0.15rem; }
  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 0.75rem;
    margin: 0 0 0.5rem;
    color: var(--text-muted);
  }
  .markdown-body :global(a) { color: var(--accent); text-decoration: none; }
  .markdown-body :global(a:hover) { text-decoration: underline; }
  .markdown-body :global(code) {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    background: rgba(255, 255, 255, 0.06);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.82rem;
  }
  .markdown-body :global(pre) {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin: 0 0 0.5rem;
    overflow-x: auto;
  }
  .markdown-body :global(pre code) {
    background: none;
    padding: 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: #e6edf3;
  }
  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.75rem 0;
  }
  .markdown-body :global(strong) { font-weight: 600; }
  .markdown-body :global(em) { font-style: italic; }
</style>
