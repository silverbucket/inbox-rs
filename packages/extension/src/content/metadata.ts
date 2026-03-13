// Content script that extracts page metadata when requested
function getMetadata() {
  const getMeta = (name: string): string | undefined => {
    const el = document.querySelector(
      `meta[property="${name}"], meta[name="${name}"]`
    ) as HTMLMetaElement | null;
    return el?.content || undefined;
  };

  const favicon = (() => {
    const link = document.querySelector(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
    ) as HTMLLinkElement | null;
    if (link?.href) return link.href;
    try {
      return new URL('/favicon.ico', location.origin).href;
    } catch {
      return undefined;
    }
  })();

  // Extract embedded content for specific sites
  const embeddedContent = getEmbeddedContent();

  // Extract tweet images if on Twitter/X
  const host = location.hostname.replace(/^www\./, '');
  const tweetImages = (host === 'twitter.com' || host === 'x.com')
    ? extractTweetImages()
    : [];

  return {
    title: getMeta('og:title') || document.title || '',
    description: getMeta('og:description') || getMeta('description') || '',
    ogImage: getMeta('og:image') || getMeta('twitter:image') || undefined,
    siteName: getMeta('og:site_name') || undefined,
    favicon,
    embeddedContent,
    tweetImages
  };
}

/** Extract the main content from known sites (tweets, posts, etc.) */
function getEmbeddedContent(): string | undefined {
  const host = location.hostname.replace(/^www\./, '');

  // Twitter / X
  if (host === 'twitter.com' || host === 'x.com') {
    return extractTweet();
  }

  // Mastodon / Fediverse (common pattern)
  const mastodonContent = document.querySelector('.e-content, .status__content');
  if (mastodonContent) {
    return mastodonContent.textContent?.trim() || undefined;
  }

  // Reddit
  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    const postBody = document.querySelector('[data-click-id="text"] .md, .RichTextJSON-root, shreddit-post');
    if (postBody) return postBody.textContent?.trim() || undefined;
  }

  // Hacker News
  if (host === 'news.ycombinator.com') {
    const toptext = document.querySelector('.toptext');
    if (toptext) return toptext.textContent?.trim() || undefined;
  }

  return undefined;
}

/** Extract tweet text and images from Twitter/X */
function extractTweet(): string | undefined {
  // Try the tweet article on a single tweet page
  const tweetArticle = document.querySelector('article[data-testid="tweet"]');
  if (!tweetArticle) return undefined;

  // Get the tweet text
  const tweetText = tweetArticle.querySelector('[data-testid="tweetText"]');
  const text = tweetText?.textContent?.trim() || '';

  // Get the author
  const authorEl = tweetArticle.querySelector('[data-testid="User-Name"]');
  const author = authorEl?.textContent?.trim() || '';

  if (!text && !author) return undefined;

  let result = '';
  if (author) result += `${author}\n\n`;
  if (text) result += text;
  return result.trim() || undefined;
}

/** Check if a URL is a tweet content image (not avatar/emoji/icon) */
function isTweetContentImage(src: string): boolean {
  if (!src) return false;
  // Must be on Twitter's image CDN
  if (!src.includes('pbs.twimg.com/')) return false;
  // Exclude profile images, emojis, and UI assets
  if (src.includes('/profile_images/')) return false;
  if (src.includes('/emoji/')) return false;
  if (src.includes('/hashflags/')) return false;
  return true;
}

/** Upgrade a Twitter image URL to high quality */
function upgradeTwitterImageUrl(src: string): string {
  try {
    const url = new URL(src);
    // Request large format for pbs.twimg.com images
    if (url.hostname === 'pbs.twimg.com') {
      url.searchParams.set('name', 'large');
    }
    return url.toString();
  } catch {
    return src;
  }
}

/** Extract image URLs from a tweet */
function extractTweetImages(): string[] {
  const tweetArticle = document.querySelector('article[data-testid="tweet"]');
  if (!tweetArticle) return [];

  const images: string[] = [];

  // Try specific selectors first — more reliable than scanning all imgs
  const selectors = [
    '[data-testid="tweetPhoto"] img',
    'div[data-testid="card.layoutLarge.media"] img',
    'div[data-testid="card.layoutSmall.media"] img',
  ];

  for (const sel of selectors) {
    for (const img of tweetArticle.querySelectorAll(sel)) {
      const src = (img as HTMLImageElement).src;
      if (isTweetContentImage(src)) {
        images.push(upgradeTwitterImageUrl(src));
      }
    }
  }

  // Fallback: scan ALL imgs in the tweet article
  if (images.length === 0) {
    for (const img of tweetArticle.querySelectorAll('img')) {
      const src = (img as HTMLImageElement).src;
      if (isTweetContentImage(src)) {
        images.push(upgradeTwitterImageUrl(src));
      }
    }
  }

  return [...new Set(images)];
}

/**
 * Wait for a DOM element to appear (for SPAs like Twitter that render async).
 * Returns null if the element doesn't appear within the timeout.
 */
function waitForElement(selector: string, timeout = 3000): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// Listen for messages from the background/popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'get-metadata') {
    const host = location.hostname.replace(/^www\./, '');
    const isSPA = (host === 'twitter.com' || host === 'x.com');

    if (isSPA) {
      // Wait for tweet text to render before extracting (article appears first, text loads after)
      waitForElement('[data-testid="tweetText"]').then(() => {
        sendResponse(getMetadata());
      });
      return true; // keep message channel open for async response
    }

    sendResponse(getMetadata());
  }
});
