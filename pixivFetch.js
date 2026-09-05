window.pixivEnabled = false;
let pixivRankingType = 'daily';
let pixivCurrentIndex = 0;
let pixivRankings = [];
let pixivUpdateInterval = 60; // minutes
let pixivShuffle = false;
let isPixivLoading = false;
let lastPixivAction = Date.now();
let pixivManualMode = false;
let favModeActive = localStorage.getItem('pixiv_fav_mode') === 'true';
let isRestoredFromCache = false;

// Load Blacklist from localStorage
let pixivBlacklist = new Set(JSON.parse(localStorage.getItem('pixiv_blacklist') || "[]"));
let pixivFavorites = [];

const PIXIV_PROXIES = [
    "https://pixiv.canaria.cc",
    "https://proxy.pixiv.shojo.cn",
    "https://i.pixiv.re",
    "https://i.pixiv.cat"
];

function extractPximgPath(fullUrl) {
    if (!fullUrl) return "";
    const match = fullUrl.match(/((\/c\/[^\/]+)?\/(img-original|img-master|custom-thumb)\/.+)$/);
    if (match) return match[1];
    if (fullUrl.startsWith("http")) {
        const path = fullUrl.replace(/^https?:\/\/[^\/]+/, '');
        return path.startsWith('/') ? path : '/' + path;
    }
    return fullUrl.startsWith('/') ? fullUrl : '/' + fullUrl;
}

function buildProxyUrl(rawPathOrUrl, proxyIdx = 0) {
    const proxy = PIXIV_PROXIES[proxyIdx] || PIXIV_PROXIES[0];
    if (!rawPathOrUrl) return "";

    const catMatch = rawPathOrUrl.match(/^(?:https?:\/\/(?:i\.)?pixiv\.(?:cat|nl|re)\/)?(\d+(?:-p\d+|_p\d+)?\.(?:jpg|png|gif))$/i);
    if (catMatch) {
        if (proxy.includes("shojo.cn") || proxy.includes("canaria.cc")) {
            return "https://pixiv.nl/" + catMatch[1];
        }
        return "https://pixiv.cat/" + catMatch[1];
    }

    const path = extractPximgPath(rawPathOrUrl);
    return proxy + path;
}

function saveBlacklist() {
    localStorage.setItem('pixiv_blacklist', JSON.stringify(Array.from(pixivBlacklist)));
}

// --- Favorites Persistence ---
async function saveFavoritesToPython() {
    localStorage.setItem('pixiv_favorites', JSON.stringify(pixivFavorites));
    try {
        await fetch('http://127.0.0.1:25555/media/pixiv_fav_save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorites: pixivFavorites })
        });
    } catch (e) { console.log("Fav save failed", e); }
}

async function loadFavoritesFromPython() {
    let loadedLocal = false;
    try {
        const stored = localStorage.getItem('pixiv_favorites');
        if (stored) {
            pixivFavorites = JSON.parse(stored);
            console.log(`[PIXIV] Loaded ${pixivFavorites.length} favorites from localStorage.`);
            loadedLocal = true;
        }
    } catch (e) { console.log("Local fav load failed", e); }

    try {
        const response = await fetch('http://127.0.0.1:25555/media/pixiv_fav_load');
        const state = await response.json();
        if (state && state.favorites && state.favorites.length >= pixivFavorites.length) {
            pixivFavorites = state.favorites;
            console.log(`[PIXIV] Loaded ${pixivFavorites.length} favorites from Python.`);
            localStorage.setItem('pixiv_favorites', JSON.stringify(pixivFavorites));
            return true;
        }
    } catch (e) { console.log("Fav load failed", e); }
    return loadedLocal;
}

// --- State Persistence to Python ---
async function savePixivState() {
    if (!window.pixivEnabled || pixivRankings.length === 0) return;
    try {
        console.log(`[PIXIV] Saving state to Python... (Index: ${pixivCurrentIndex})`);
        await fetch('http://127.0.0.1:25555/media/pixiv_save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                rankings: pixivRankings,
                index: pixivCurrentIndex
            })
        });
    } catch (e) { console.log("State save failed", e); }
}

async function loadPixivState() {
    try {
        console.log("[PIXIV] Attempting to load state from Python...");
        const response = await fetch('http://127.0.0.1:25555/media/pixiv_load');
        const state = await response.json();
        if (state && state.rankings && state.rankings.length > 0) {
            pixivRankings = state.rankings;
            pixivCurrentIndex = state.index || 0;
            console.log(`[PIXIV] Restored ${pixivRankings.length} wallpapers.`);
            appendLog(`[PIXIV] Restored ${pixivRankings.length} wallpapers from Python.`);
            
            // If in favorites mode, we might want to prioritize those, 
            // but for now just apply what we restored.
            if (!favModeActive) {
                applyPixivBackground();
                isRestoredFromCache = true;
                lastPixivAction = Date.now();
            }
            return true;
        }
    } catch (e) { console.log("State load failed", e); }
    return false;
}

// Heartbeat for Sleep Detection & Interval Management
let lastHeartbeat = Date.now();
setInterval(() => {
    const now = Date.now();
    const diff = now - lastHeartbeat;
    const intervalMs = pixivUpdateInterval * 60 * 1000;
    
    // Scheduled Update Check
    if (window.pixivEnabled && intervalMs > 0 && (now - lastPixivAction >= intervalMs)) {
        appendLog("[PIXIV] Interval reached. Cycling wallpaper...");
        nextPixivWallpaper();
        lastPixivAction = now;
    } 
    
    lastHeartbeat = now;
}, 2000);

async function fetchPixivRanking() {
    if (!window.pixivEnabled || isPixivLoading) return;

    isPixivLoading = true;
    lastPixivAction = Date.now();
    appendLog("[PIXIV] Fetching...");

    let allRankings = [];
    const baseUrl = "https://hibi.yunzai-bot.com/api/pixiv/rank";

    try {
        // Fetch 2 pages with size 30 each
        for (let p = 1; p <= 3; p++) {
            try {
                // Add a small delay between requests to prevent 429 (Too Many Requests)
                if (p > 1) await new Promise(r => setTimeout(r, 1500));

                const fetchUrl = `${baseUrl}?mode=day&page=${p}`;
                const response = await fetch(fetchUrl);
                
                if (!response.ok) {
                    appendLog(`[PIXIV] Page ${p} Status: ${response.status}`);
                    if (response.status === 429) break; // Stop if rate limited
                    continue;
                }

                const json = await response.json();
                
                if (json && json.illusts && Array.isArray(json.illusts)) {
                    const filtered = json.illusts
                        .filter(item => (item.width / item.height) >= 0.9)
                        .filter(item => {
                            // Tag Blacklist: Filter out manga, multi-page sets, etc.
                            const excludedTags = ["漫画", "manga", "comic", "コミック", "COMIC", 
                                "horror", "atypical appearance"];
                            if (item.tags && Array.isArray(item.tags)) {
                                const hasExcluded = item.tags.some(t => 
                                    excludedTags.includes(t.name) || 
                                    excludedTags.includes(t.translated_name)
                                );
                                if (hasExcluded) return false;
                            }
                            // Also filter out multi-page illustrations which are often manga
                            if (item.page_count && item.page_count >= 3) return false;
                            return true;
                        })
                        .map(item => {
                            let originalPximgUrl = "";
                            if (item.meta_single_page && item.meta_single_page.original_image_url) {
                                originalPximgUrl = item.meta_single_page.original_image_url;
                            } else if (item.meta_pages && item.meta_pages.length > 0 && item.meta_pages[0].image_urls && item.meta_pages[0].image_urls.original) {
                                originalPximgUrl = item.meta_pages[0].image_urls.original;
                            } else if (item.image_urls && (item.image_urls.large || item.image_urls.medium)) {
                                originalPximgUrl = item.image_urls.large || item.image_urls.medium;
                            }

                            const rawPath = extractPximgPath(originalPximgUrl);
                            const rawThumb = (item.image_urls && item.image_urls.medium) ? extractPximgPath(item.image_urls.medium) : rawPath;

                            const highRes = buildProxyUrl(rawPath, 0);
                            const thumb = buildProxyUrl(rawThumb, 1);

                            return {
                                id: item.id,
                                rawPath: rawPath,
                                rawThumb: rawThumb,
                                url: highRes,
                                thumb: thumb,
                                title: item.title,
                                user: (item.user ? item.user.name : "Unknown"),
                                link: `https://www.pixiv.net/artworks/${item.id}`
                            };
                        })
                        .filter(item => !pixivBlacklist.has(item.url));
                    
                    allRankings = allRankings.concat(filtered);
                    appendLog(`[PIXIV] Page ${p}: Found ${filtered.length} horizontal wallpapers.`);
                }
            } catch (e) { 
                appendLog(`[PIXIV] Page ${p} fetch failed.`);
            }
        }

        isPixivLoading = false;
        
        // Deduplicate
        const seenUrls = new Set();
        const freshRankings = allRankings.filter(item => {
            if (seenUrls.has(item.url)) return false;
            seenUrls.add(item.url);
            return true;
        });

        if (freshRankings.length > 0) {
            if (pixivShuffle) freshRankings.sort(() => Math.random() - 0.5);

            if (isRestoredFromCache && pixivRankings.length > 0) {
                const currentIllust = pixivRankings[pixivCurrentIndex];
                const currentId = currentIllust ? currentIllust.id : null;
                const foundIndex = currentId ? freshRankings.findIndex(item => item.id === currentId) : -1;

                pixivRankings = freshRankings;
                if (foundIndex !== -1) {
                    pixivCurrentIndex = foundIndex;
                }
                appendLog(`[PIXIV] Updated queue (${pixivRankings.length} wallpapers). Keeping cached wallpaper until next interval.`);
                savePixivState();
            } else {
                pixivRankings = freshRankings;
                pixivCurrentIndex = 0;
                appendLog(`[PIXIV] Successfully loaded ${pixivRankings.length} wallpapers.`);
                applyPixivBackground();
                savePixivState();
            }
        } else {
            fetchAlternativeRanking();
        }
    } catch (error) {
        isPixivLoading = false;
        fetchAlternativeRanking();
    }
}

// doesn't work
function fetchAlternativeRanking() {
    isPixivLoading = true;
    appendLog("[PIXIV] Fetching from Fallback (Lolicon API)...");
    
    fetch('https://api.lolicon.app/setu/v2?r18=0&num=100')
        .then(response => response.json())
        .then(data => {
            isPixivLoading = false;
            if (data && data.data && data.data.length > 0) {
                let horizontalFallback = data.data
                    .filter(item => item.width > item.height)
                    .map(item => {
                        const originalUrl = (item.urls.original || item.urls.regular || "");
                        const thumbUrl = (item.urls.small || item.urls.thumb || originalUrl);
                        const rawPath = extractPximgPath(originalUrl);
                        const rawThumb = extractPximgPath(thumbUrl);
                        return {
                            id: item.pid,
                            rawPath: rawPath,
                            rawThumb: rawThumb,
                            url: buildProxyUrl(rawPath, 0),
                            thumb: buildProxyUrl(rawThumb, 1),
                            title: item.title,
                            user: item.author,
                            link: `https://www.pixiv.net/artworks/${item.pid}`
                        };
                    })
                    .filter(item => item.url !== "" && !pixivBlacklist.has(item.url));

                if (horizontalFallback.length > 0) {
                    if (pixivShuffle) horizontalFallback.sort(() => Math.random() - 0.5);

                    if (isRestoredFromCache && pixivRankings.length > 0) {
                        const currentIllust = pixivRankings[pixivCurrentIndex];
                        const currentId = currentIllust ? currentIllust.id : null;
                        const foundIndex = currentId ? horizontalFallback.findIndex(item => item.id === currentId) : -1;

                        pixivRankings = horizontalFallback;
                        if (foundIndex !== -1) {
                            pixivCurrentIndex = foundIndex;
                        }
                        appendLog(`[PIXIV] Fallback ranking refreshed (${pixivRankings.length} images). Keeping cached wallpaper until next interval.`);
                        savePixivState();
                    } else {
                        pixivRankings = horizontalFallback;
                        pixivCurrentIndex = 0;
                        applyPixivBackground();
                        appendLog(`[PIXIV] Fallback successful: Found ${pixivRankings.length} images.`);
                        savePixivState();
                    }
                } else {
                    appendLog("[PIXIV] Fallback returned no horizontal images.");
                }
            } else {
                appendLog("[PIXIV] Fallback API returned no data.");
            }
        })
        .catch(error => {
            isPixivLoading = false;
            appendLog("[PIXIV] All sources failed.");
        });
}

function applyPixivBackground() {
    if (!window.pixivEnabled || pixivRankings.length === 0) return;

    const illust = pixivRankings[pixivCurrentIndex];
    if (!illust) return;

    loadPixivWallpaper(illust, false);
}

function applySpecificBackground(illust) {
    if (!illust) return;
    loadPixivWallpaper(illust, true);
}

function loadPixivWallpaper(illust, isFavorite = false) {
    const videoLayer = document.getElementById('bg-layer-video');
    const imageLayer = document.getElementById('bg-layer-image');
    const btnNext = document.getElementById('btn-pixiv-next');

    if (btnNext) btnNext.style.display = 'block';

    // Hide video
    if (videoLayer) {
        videoLayer.style.display = 'none';
        videoLayer.removeAttribute('src');
        videoLayer.load();
    }

    const rawPath = illust.rawPath || illust.url;
    let proxyIdx = 0;

    function tryLoadNextProxy() {
        if (proxyIdx >= PIXIV_PROXIES.length) {
            appendLog(`[PIXIV] Failed to load wallpaper across all proxies: ${illust.title}`);
            if (imageLayer) {
                imageLayer.style.backgroundImage = `url('${buildProxyUrl(rawPath, 0)}')`;
                imageLayer.style.display = 'block';
            }
            return;
        }

        const currentProxy = PIXIV_PROXIES[proxyIdx];
        const targetUrl = buildProxyUrl(rawPath, proxyIdx);

        // Preload image to test availability before setting background
        const tempImg = new Image();
        tempImg.onload = () => {
            if (imageLayer) {
                imageLayer.style.backgroundImage = `url('${targetUrl}')`;
                imageLayer.style.display = 'block';
            }
            updatePixivDim();
            document.body.style.backgroundImage = 'none';
            if (typeof updateGalleryActiveState === 'function') {
                updateGalleryActiveState();
            }
            const proxyName = currentProxy.replace(/^https?:\/\//, '');
            if (isFavorite) {
                appendLog(`[FAVORITE] Applied (${proxyName}): ${illust.title}`);
            } else {
                appendLog(`[PIXIV] Applied (${proxyName}): ${illust.title} by ${illust.user}`);
                savePixivState();
            }
        };
        tempImg.onerror = () => {
            console.warn(`[PIXIV] Proxy ${currentProxy} failed for ${illust.title}, trying next proxy...`);
            proxyIdx++;
            tryLoadNextProxy();
        };
        tempImg.src = targetUrl;
    }

    tryLoadNextProxy();
}

function updatePixivDim() {
    const overlayLayer = document.getElementById('bg-layer-overlay');
    if (overlayLayer) {
        const dimAlpha = (window.currentBgDim !== undefined) ? window.currentBgDim : 0.6;
        overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${dimAlpha})`;
        overlayLayer.style.display = 'block';
    }
}

function nextPixivWallpaper() {
    if (!window.pixivEnabled) return;
    isRestoredFromCache = false;
    
    if (favModeActive && pixivFavorites.length > 0) {
        pixivCurrentIndex = (pixivCurrentIndex + 1) % pixivFavorites.length;
        applySpecificBackground(pixivFavorites[pixivCurrentIndex]);
    } else if (pixivRankings.length > 0) {
        pixivCurrentIndex = (pixivCurrentIndex + 1) % pixivRankings.length;
        applyPixivBackground();
    }
    lastPixivAction = Date.now();
}

const toggleFavMode = document.getElementById('toggle-fav-mode');
if (toggleFavMode) {
    toggleFavMode.onclick = () => {
        favModeActive = !favModeActive;
        localStorage.setItem('pixiv_fav_mode', favModeActive);
        toggleFavMode.textContent = favModeActive ? "[ ENABLED ]" : "[ DISABLED ]";
        
        if (favModeActive && pixivFavorites.length > 0) {
            pixivCurrentIndex = 0;
            applySpecificBackground(pixivFavorites[0]);
        } else {
            if (typeof refreshBackground === 'function') refreshBackground();
        }
        
        if (document.getElementById('widget-pixiv-gallery').style.display !== 'none') {
            renderPixivGallery();
        }
    };
    // Sync label on load
    toggleFavMode.textContent = favModeActive ? "[ ENABLED ]" : "[ DISABLED ]";
}

function updatePixivUI() {
    const togglePixivBg = document.getElementById('toggle-pixiv-bg');
    if (togglePixivBg) {
        togglePixivBg.textContent = window.pixivEnabled ? "[ ENABLED ]" : "[ DISABLED ]";
    }
    const btnNext = document.getElementById('btn-pixiv-next');
    if (btnNext) {
        btnNext.style.display = window.pixivEnabled ? 'block' : 'none';
    }
}

const btnPixivNext = document.getElementById('btn-pixiv-next');
if (btnPixivNext) {
    btnPixivNext.addEventListener('click', (e) => {
        e.stopPropagation();
        nextPixivWallpaper();
    });
}

window.myPropertyHandlers = window.myPropertyHandlers || [];
window.myPropertyHandlers.push(function(properties) {
    let shouldFetch = false;

    if (properties.pixiv_enabled !== undefined) {
        const newValue = properties.pixiv_enabled.value;
        if (newValue && !window.pixivEnabled) {
            shouldFetch = true;
        } else if (!newValue && window.pixivEnabled) {
            // Disabling
            if (typeof refreshBackground === 'function') refreshBackground();
        }
        window.pixivEnabled = newValue;
        updatePixivUI(); // Sync the SETTINGS.EXE label
    }

    if (properties.pixiv_update_interval !== undefined) {
        pixivUpdateInterval = properties.pixiv_update_interval.value;
        lastPixivAction = Date.now();
    }

    if (properties.pixiv_shuffle !== undefined) {
        pixivShuffle = properties.pixiv_shuffle.value;
        if (window.pixivEnabled && pixivRankings.length > 0) {
            if (pixivShuffle) {
                pixivRankings = pixivRankings.sort(() => Math.random() - 0.5);
                pixivCurrentIndex = 0;
                applyPixivBackground();
            }
        }
    }

    if (shouldFetch && window.pixivEnabled) {
        fetchPixivRanking();
    }
    
    if (properties.bg_dim !== undefined && window.pixivEnabled && pixivRankings.length > 0) {
        updatePixivDim();
    }
});

// --- Pixiv Gallery UI Logic ---
function updateGalleryActiveState() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;
    const activeBg = document.getElementById('bg-layer-image').style.backgroundImage || '';
    const displayList = favModeActive ? pixivFavorites : pixivRankings;

    const items = grid.querySelectorAll('.gallery-item');
    items.forEach((it, i) => {
        const illust = displayList[i];
        const isItemActive = (i === pixivCurrentIndex) || (illust && (
            (illust.rawPath && activeBg.includes(illust.rawPath)) || 
            (illust.id && activeBg.includes(String(illust.id))) ||
            (illust.url && activeBg.includes(illust.url))
        ));
        it.classList.toggle('active', !!isItemActive);
    });
}

function renderPixivGallery() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    const currentMode = favModeActive ? 'fav' : 'rank';
    grid.setAttribute('data-mode', currentMode);
    
    // Determine which list to show in gallery
    const displayList = favModeActive ? pixivFavorites : pixivRankings;

    displayList.forEach((illust, index) => {
        const item = document.createElement('div');
        const activeBg = document.getElementById('bg-layer-image').style.backgroundImage || '';
        const isItemActive = (index === pixivCurrentIndex) || 
                             (illust.rawPath && activeBg.includes(illust.rawPath)) || 
                             (illust.id && activeBg.includes(String(illust.id))) ||
                             (illust.url && activeBg.includes(illust.url));

        const isFav = pixivFavorites.some(f => 
            f.url === illust.url || 
            (f.id && illust.id && f.id === illust.id) ||
            (f.rawPath && illust.rawPath && f.rawPath === illust.rawPath)
        );

        item.className = 'gallery-item' + (isItemActive ? ' active' : '');
        
        const initialThumb = buildProxyUrl(illust.rawThumb || illust.rawPath || illust.thumb || illust.url, 1);

        item.innerHTML = `
            <img src="${initialThumb}" loading="lazy" data-proxy-idx="1">
            <div class="gallery-remove-btn">X</div>
            <div class="gallery-fav-btn ${isFav ? 'is-fav' : ''}">${isFav ? '♥' : '♡'}</div>
            <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); padding: 2px 5px; font-size: 9px;" class="white col">
                ${illust.title}
            </div>
        `;
        
        // Thumbnail Fallback on Error
        const imgEl = item.querySelector('img');
        if (imgEl) {
            imgEl.onerror = function() {
                let currentIdx = parseInt(this.getAttribute('data-proxy-idx') || '0', 10);
                currentIdx = (currentIdx + 1) % PIXIV_PROXIES.length;
                if (currentIdx !== 1) { // avoid infinite loop if cycled through all
                    this.setAttribute('data-proxy-idx', currentIdx);
                    this.src = buildProxyUrl(illust.rawThumb || illust.rawPath || illust.thumb || illust.url, currentIdx);
                }
            };
        }

        // Manual Select (DO NOT re-render the gallery - only update active class!)
        item.onclick = (e) => {
            e.stopPropagation();
            pixivCurrentIndex = index;
            pixivManualMode = true;
            
            if (favModeActive) {
                applySpecificBackground(illust);
            } else {
                applyPixivBackground();
            }

            // Instantly highlight the clicked item without clearing the DOM or reloading images
            const allItems = grid.querySelectorAll('.gallery-item');
            allItems.forEach((it, i) => {
                it.classList.toggle('active', i === index);
            });
        };

        // Favorite Toggle
        const favBtn = item.querySelector('.gallery-fav-btn');
        favBtn.onclick = (e) => {
            e.stopPropagation();
            const existingIndex = pixivFavorites.findIndex(f => 
                f.url === illust.url || 
                (f.id && illust.id && f.id === illust.id) ||
                (f.rawPath && illust.rawPath && f.rawPath === illust.rawPath)
            );

            if (existingIndex > -1) {
                // Remove from favorites
                pixivFavorites.splice(existingIndex, 1);
                favBtn.classList.remove('is-fav');
                favBtn.textContent = '♡';
                
                // If we are in Favs Mode, remove just this card from DOM
                if (favModeActive) {
                    item.remove();
                    if (isItemActive) {
                        if (pixivFavorites.length > 0) {
                            nextPixivWallpaper();
                        } else {
                            refreshBackground(); // Go back to default if no favs left
                        }
                    }
                }
            } else {
                // Add to favorites
                pixivFavorites.push(illust);
                favBtn.classList.add('is-fav');
                favBtn.textContent = '♥';
            }
            
            saveFavoritesToPython();
        };

        // Remove from Gallery / Blacklist
        const removeBtn = item.querySelector('.gallery-remove-btn');
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            const urlToRemove = illust.url;
            pixivBlacklist.add(urlToRemove);
            if (illust.id) pixivBlacklist.add(String(illust.id));
            saveBlacklist();
            
            if (favModeActive) {
                pixivFavorites = pixivFavorites.filter(f => f.url !== urlToRemove && (!illust.id || f.id !== illust.id));
                saveFavoritesToPython();
            } else {
                pixivRankings = pixivRankings.filter(item => item.url !== urlToRemove && (!illust.id || item.id !== illust.id));
            }

            // Remove only this card without re-rendering the whole gallery
            item.remove();
        };
        
        grid.appendChild(item);
    });
}

const btnOpenGallery = document.getElementById('btn-open-gallery');
const widgetGallery = document.getElementById('widget-pixiv-gallery');
const btnCloseGallery = document.getElementById('btn-close-gallery');

if (btnOpenGallery && widgetGallery) {
    btnOpenGallery.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = widgetGallery.style.display === 'none';
        widgetGallery.style.display = isHidden ? 'flex' : 'none';
        
        if (isHidden) {
            const currentMode = favModeActive ? 'fav' : 'rank';
            const grid = document.getElementById('gallery-grid');
            if (grid && (grid.getAttribute('data-mode') !== currentMode || grid.children.length === 0)) {
                renderPixivGallery();
            } else {
                updateGalleryActiveState();
            }
            // Position near settings
            const settingsRect = document.getElementById('widget-settings').getBoundingClientRect();
            widgetGallery.style.left = (settingsRect.left - 460) + "px";
            widgetGallery.style.top = settingsRect.top + "px";
        }
    });
}

if (btnCloseGallery) {
    btnCloseGallery.addEventListener('click', () => {
        widgetGallery.style.display = 'none';
    });
}

const btnGalUp = document.getElementById('btn-gal-up');
const btnGalDown = document.getElementById('btn-gal-down');
const galleryGrid = document.getElementById('gallery-grid');

if (btnGalUp && galleryGrid) {
    btnGalUp.addEventListener('click', (e) => {
        e.stopPropagation();
        galleryGrid.scrollBy({ top: -200, behavior: 'smooth' });
    });
}

if (btnGalDown && galleryGrid) {
    btnGalDown.addEventListener('click', (e) => {
        e.stopPropagation();
        galleryGrid.scrollBy({ top: 200, behavior: 'smooth' });
    });
}

// --- Initialization ---
(async () => {
    // Load favorites first
    await loadFavoritesFromPython();
    
    // Try to restore from Python first for instant display
    const restored = await loadPixivState();
    if (!restored && window.pixivEnabled) {
        // Only fetch if nothing to restore
        fetchPixivRanking();
    }
})();
