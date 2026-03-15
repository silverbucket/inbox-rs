<script lang="ts">
  import type { CodeSnippetItem } from '@inbox-rs/rs-module';
  import hljs from 'highlight.js/lib/core';
  import 'highlight.js/styles/github-dark.min.css';

  // Register common languages on demand
  const langModules: Record<string, () => Promise<any>> = {
    javascript: () => import('highlight.js/lib/languages/javascript'),
    typescript: () => import('highlight.js/lib/languages/typescript'),
    python: () => import('highlight.js/lib/languages/python'),
    rust: () => import('highlight.js/lib/languages/rust'),
    go: () => import('highlight.js/lib/languages/go'),
    bash: () => import('highlight.js/lib/languages/bash'),
    shell: () => import('highlight.js/lib/languages/shell'),
    json: () => import('highlight.js/lib/languages/json'),
    html: () => import('highlight.js/lib/languages/xml'),
    xml: () => import('highlight.js/lib/languages/xml'),
    css: () => import('highlight.js/lib/languages/css'),
    sql: () => import('highlight.js/lib/languages/sql'),
    java: () => import('highlight.js/lib/languages/java'),
    c: () => import('highlight.js/lib/languages/c'),
    cpp: () => import('highlight.js/lib/languages/cpp'),
    csharp: () => import('highlight.js/lib/languages/csharp'),
    ruby: () => import('highlight.js/lib/languages/ruby'),
    php: () => import('highlight.js/lib/languages/php'),
    swift: () => import('highlight.js/lib/languages/swift'),
    kotlin: () => import('highlight.js/lib/languages/kotlin'),
    yaml: () => import('highlight.js/lib/languages/yaml'),
    markdown: () => import('highlight.js/lib/languages/markdown'),
    dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
    svelte: () => import('highlight.js/lib/languages/xml'),
  };

  // Aliases
  const langAliases: Record<string, string> = {
    js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
    sh: 'bash', zsh: 'bash', yml: 'yaml', 'c++': 'cpp', 'c#': 'csharp',
    htm: 'html', md: 'markdown',
  };

  let { item }: { item: CodeSnippetItem } = $props();
  let highlightedHtml = $state('');

  $effect(() => {
    const lang = item.language?.toLowerCase() || '';
    const resolved = langAliases[lang] || lang;
    const loader = langModules[resolved];

    if (loader && !hljs.getLanguage(resolved)) {
      loader().then(mod => {
        hljs.registerLanguage(resolved, mod.default);
        const result = hljs.highlight(item.body, { language: resolved });
        highlightedHtml = result.value;
      });
    } else if (hljs.getLanguage(resolved)) {
      const result = hljs.highlight(item.body, { language: resolved });
      highlightedHtml = result.value;
    } else {
      highlightedHtml = '';
    }
  });
</script>

<div class="code-snippet">
  <div class="header">
    <h3 class="title">{item.title}</h3>
    {#if item.language}
      <span class="language-badge">{item.language}</span>
    {/if}
  </div>
  <pre class="code"><code>{#if highlightedHtml}{@html highlightedHtml}{:else}{item.body}{/if}</code></pre>
</div>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
  }

  .title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .language-badge {
    background: rgba(99, 102, 241, 0.15);
    color: var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: lowercase;
  }

  .code {
    background: #0d1117;
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    font-size: 0.8rem;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 12;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0;
  }

  code {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
    color: #e6edf3;
  }

  /* Override highlight.js background to match our card */
  :global(.code .hljs) {
    background: transparent;
    padding: 0;
  }
</style>
