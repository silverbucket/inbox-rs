<script lang="ts">
 import {bulkEnrichProgress,bulkImageProgress,enrichAllBookmarks,imageCopyCandidates,removeStoredImageCopies,saveAllBookmarkImages,storedCopyCandidates,LOCAL_KEEP_LINK_IMAGES_KEY,LOCAL_LINK_PREVIEWS_KEY,linkNoteUrl,resolveSockethubEndpoint} from '../../lib/enrich'; import {canDownloadImages} from '../../lib/link-metadata'; import {connected,items,userSettings,updateUserSettings} from '../../lib/stores'; import {isSavedLink,needsLinkPreview} from '../../lib/enrich'; import {showToast} from '../../lib/toast';
 const read=(k:string)=>{try{return localStorage.getItem(k)}catch{return null}}; const write=(k:string,v:string)=>{try{localStorage.setItem(k,v)}catch{}}; let localOn=$state(read(LOCAL_LINK_PREVIEWS_KEY)!=='false'); const on=$derived($userSettings.linkPreviews!==false&&localOn); const missingLinks=$derived(Object.values($items).filter(needsLinkPreview)); const missing=$derived(missingLinks.length); const total=$derived(Object.values($items).filter(isSavedLink).length);
 function toggle(v:boolean){localOn=v;write(LOCAL_LINK_PREVIEWS_KEY,String(v));if($connected)void updateUserSettings({linkPreviews:v?undefined:false})} function fetchAll(){void enrichAllBookmarks().then(r=>r&&showToast(`Updated ${r.updated} of ${r.total} bookmarks${r.failed?` — ${r.failed} failed`:''}`)).catch(()=>showToast('Failed to fetch link previews'))} async function copyMissingUrls(){const urls=missingLinks.map(item=>item.type==='bookmark'?item.url:linkNoteUrl(item)).filter((url):url is string=>!!url).map(url=>url.replace(/[\r\n]/g,''));if(!urls.length){showToast('No URLs to copy');return}try{await navigator.clipboard.writeText(urls.join('\n'));showToast(`Copied ${urls.length} URLs`)}catch{showToast('Could not copy URLs')}}
 // Keeping a copy of each preview image: on unless turned off, and only
 // possible when the link preview service can download images.
 let localKeep=$state(read(LOCAL_KEEP_LINK_IMAGES_KEY)!=='false'); const keep=$derived($userSettings.keepLinkImages!==false&&localKeep); let canKeep=$state(true);
 $effect(()=>{void $userSettings.sockethubUrl;if(!on)return;let current=true;void canDownloadImages(resolveSockethubEndpoint()).then(v=>{if(current)canKeep=v});return()=>{current=false}});
 function toggleKeep(v:boolean){localKeep=v;write(LOCAL_KEEP_LINK_IMAGES_KEY,String(v));confirmRemove=false;if($connected)void updateUserSettings({keepLinkImages:v?undefined:false})}
 // Bookmarks saved before copies were kept, and the way back for someone
 // who turned copies off: each is offered only on its side of the switch.
 const uncopied = $derived(imageCopyCandidates($items).length);
 const copied = $derived(storedCopyCandidates($items).length);
 const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
 let confirmRemove = $state(false);
 function saveImages() {
   void saveAllBookmarkImages()
     .then((r) => {
       if (!r) return;
       const failed = [
         r.gone && `${r.gone} gone from their site`,
         r.refused && `${r.refused} refused by their site`,
         r.tooLarge && `${r.tooLarge} too large`,
         r.other && `${r.other} not saved`,
       ].filter(Boolean);
       showToast(`Saved ${r.saved} of ${plural(r.total, 'image', 'images')}${failed.length ? ` — ${failed.join(', ')}` : ''}`);
     })
     .catch(() => showToast('Failed to save images'));
 }
 function removeCopies() {
   confirmRemove = false;
   void removeStoredImageCopies()
     .then((r) => r && showToast(`Removed ${plural(r.removed, 'stored copy', 'stored copies')}`))
     .catch(() => showToast('Failed to remove stored copies'));
 }
</script>
<div class="settings-section"><div class="row"><div class="row-main"><div class="row-label">Show previews for saved links</div><div class="row-desc">Fetched via <a href="https://sockethub.org" target="_blank" rel="noreferrer">Sockethub</a>'s <code>metadata</code> platform — the page title, description and image, without your browser ever contacting the site. A link on a line of its own in a note or todo gets a preview too. Change the link preview service in Settings → Account.</div></div><div class="row-ctl"><button type="button" class="switch" class:on aria-label="Show previews for saved links" aria-pressed={on} onclick={()=>toggle(!on)}></button></div></div>
{#if on}<div class="row"><div class="row-main"><div class="row-label">Keep a copy of preview images</div><div class="row-desc">{#if canKeep}Saved links keep their image even if the site goes away. Copies use space in your storage. When off, images load from the original site.{:else}Not available: your link preview service can't download images, so they load from the original site. Change the service in Settings → Account.{/if}</div></div><div class="row-ctl"><button type="button" class="switch" class:on={keep&&canKeep} aria-label="Keep a copy of preview images" aria-pressed={keep&&canKeep} disabled={!canKeep} onclick={()=>toggleKeep(!keep)}></button></div></div>
<div class="row"><div class="row-main"><div class="row-label">Fill in older bookmarks</div><div class="row-desc">{missing} of {total} saved links have no preview yet.</div></div><div class="row-ctl">{#if missing}<button class="btn secondary" type="button" onclick={copyMissingUrls}>Copy URLs</button>{/if}<button class="btn" type="button" disabled={!missing||!!$bulkEnrichProgress} onclick={fetchAll}>{$bulkEnrichProgress?`${$bulkEnrichProgress.done}/${$bulkEnrichProgress.total}`:`Fetch ${missing} previews`}</button></div></div>
{#if keep && canKeep}
<div class="row"><div class="row-main"><div class="row-label">Save images locally</div><div class="row-desc">{#if uncopied}{uncopied === 1 ? '1 saved link still loads its image' : `${uncopied} saved links still load their image`} from the original site. A saved copy keeps the image if that site goes away.{:else}Every saved link that has an image keeps its own copy.{/if}</div></div><div class="row-ctl"><button class="btn" type="button" disabled={!uncopied || !!$bulkImageProgress} onclick={saveImages}>{$bulkImageProgress ? `${$bulkImageProgress.done}/${$bulkImageProgress.total}` : `Save ${plural(uncopied, 'image', 'images')}`}</button></div></div>
{:else if !keep && (copied || $bulkImageProgress)}
<div class="row"><div class="row-main"><div class="row-label">Remove stored copies</div><div class="row-desc">{#if confirmRemove}Remove {plural(copied, 'stored copy', 'stored copies')}? The links then load the image from the original site, and lose it if that site goes away.{:else}{copied === 1 ? '1 saved link has a stored copy of its image' : `${copied} saved links have a stored copy of their image`}. Removing the copies frees the space; the links then load the image from the original site.{/if}</div></div><div class="row-ctl">{#if $bulkImageProgress}<button class="btn" type="button" disabled>{$bulkImageProgress.done}/{$bulkImageProgress.total}</button>{:else if confirmRemove}<button class="btn" type="button" onclick={() => (confirmRemove = false)}>Keep</button><button class="btn danger" type="button" onclick={removeCopies}>Remove</button>{:else}<button class="btn" type="button" onclick={() => (confirmRemove = true)}>Remove {plural(copied, 'copy', 'copies')}…</button>{/if}</div></div>
{/if}{/if}</div>
