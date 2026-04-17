import hljs from 'highlight.js/lib/core';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

export const langModules: Record<string, () => Promise<any>> = {
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

export const langAliases: Record<string, string> = {
  js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
  sh: 'bash', zsh: 'bash', yml: 'yaml', 'c++': 'cpp', 'c#': 'csharp',
  htm: 'html', md: 'markdown',
};

async function ensureLanguage(lang: string): Promise<string | null> {
  const resolved = langAliases[lang] || lang;
  const loader = langModules[resolved];
  if (!loader) return null;
  if (!hljs.getLanguage(resolved)) {
    const mod = await loader();
    hljs.registerLanguage(resolved, mod.default);
  }
  return resolved;
}

export async function renderMarkdown(source: string): Promise<string> {
  // Collect code block languages so we can load them before rendering
  const langsToLoad = new Set<string>();
  const langPattern = /^```([\w+#.-]+)/gm;
  let match: RegExpExecArray | null = null;
  while ((match = langPattern.exec(source)) !== null) {
    langsToLoad.add(match[1].toLowerCase());
  }

  // Load all languages in parallel, tolerating individual failures
  const loaded = new Map<string, string>();
  await Promise.allSettled(
    [...langsToLoad].map(async (lang) => {
      const resolved = await ensureLanguage(lang);
      if (resolved) loaded.set(lang, resolved);
    })
  );

  // Configure renderer with highlight support
  const renderer = {
    code({ text, lang }: { text: string; lang?: string }) {
      const rawLang = (lang || '').toLowerCase();
      const resolved = loaded.get(rawLang) || (langAliases[rawLang] || rawLang);
      if (resolved && hljs.getLanguage(resolved)) {
        const highlighted = hljs.highlight(text, { language: resolved }).value;
        return `<pre><code class="hljs language-${resolved}">${highlighted}</code></pre>`;
      }
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<pre><code>${escaped}</code></pre>`;
    },
  };

  const marked = new Marked({
    gfm: true,
    breaks: true,
  });

  marked.use({ renderer });
  const rendered = await marked.parse(source);

  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
  });
}
