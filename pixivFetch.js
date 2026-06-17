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

// Load Blacklist from localStorage
let pixivBlacklist = new Set(JSON.parse(localStorage.getItem('pixiv_blacklist') || "[]"));
let pixivFavorites = [];

function saveBlacklist() {
    localStorage.setItem('pixiv_blacklist', JSON.stringify(Array.from(pixivBlacklist)));
}

// --- Favorites Persistence ---
async function saveFavoritesToPython() {
    try {
        await fetch('http://127.0.0.1:25555/media/pixiv_fav_save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ favorites: pixivFavorites })
        });
    } catch (e) { console.log("Fav save failed", e); }
}

async function loadFavoritesFromPython() {
    try {
        const response = await fetch('http://127.0.0.1:25555/media/pixiv_fav_load');
        const state = await response.json();
        if (state && state.favorites) {
            pixivFavorites = state.favorites;
            console.log(`[PIXIV] Loaded ${pixivFavorites.length} favorites from Python.`);
            return true;
        }
    } catch (e) { console.log("Fav load failed", e); }
    return false;
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
    // User confirmed working endpoint
    const baseUrl = "https://hibi.yunzai-bot.com/api/pixiv/rank";

    try {
        // Fetch 2 pages with size 50 each
        for (let p = 1; p <= 3; p++) {
            try {
                // Add a small delay between requests to prevent 429 (Too Many Requests)
                if (p > 1) await new Promise(r => setTimeout(r, 1500));

                const fetchUrl = `${baseUrl}?mode=day&page=${p}&size=50`;
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
                            /* if (item.page_count && item.page_count > 1) return false; */
                            return true;
                        })
                        .map(item => {
                            // Use pixiv.cat for high-res background
                            const highRes = `https://pixiv.cat/${item.id}.jpg`;
                            
                            // Extract thumbnail from medium url if possible, otherwise fallback to highRes
                            let thumb = highRes;
                            if (item.image_urls && item.image_urls.medium) {
                                thumb = item.image_urls.medium.replace('i.pximg.net', 'i.pixiv.cat');
                            }
                            
                            return {
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
        pixivRankings = allRankings.filter(item => {
            if (seenUrls.has(item.url)) return false;
            seenUrls.add(item.url);
            return true;
        });

        if (pixivRankings.length > 0) {
            if (pixivShuffle) pixivRankings.sort(() => Math.random() - 0.5);
            pixivCurrentIndex = 0;
            appendLog(`[PIXIV] Successfully loaded ${pixivRankings.length} wallpapers.`);
            applyPixivBackground();
            savePixivState(); // Persist to Python
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
                        const originalUrl = (item.urls.original || item.urls.regular || "").replace('i.pximg.net', 'i.pixiv.cat');
                        const thumbUrl = (item.urls.small || item.urls.thumb || originalUrl).replace('i.pximg.net', 'i.pixiv.cat');
                        return {
                            url: originalUrl,
                            thumb: thumbUrl,
                            title: item.title,
                            user: item.author,
                            link: `https://www.pixiv.net/artworks/${item.pid}`
                        };
                    })
                    .filter(item => item.url !== "" && !pixivBlacklist.has(item.url));

                if (horizontalFallback.length > 0) {
                    if (pixivShuffle) horizontalFallback.sort(() => Math.random() - 0.5);
                    pixivRankings = horizontalFallback;
                    pixivCurrentIndex = 0;
                    applyPixivBackground();
                    appendLog(`[PIXIV] Fallback successful: Found ${pixivRankings.length} images.`);
                    savePixivState();
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

    const imageUrl = illust.url;
    
    const videoLayer = document.getElementById('bg-layer-video');
    const imageLayer = document.getElementById('bg-layer-image');
    const overlayLayer = document.getElementById('bg-layer-overlay');
    const btnNext = document.getElementById('btn-pixiv-next');

    if (btnNext) btnNext.style.display = 'block';

    // Hide video
    if (videoLayer) {
        videoLayer.style.display = 'none';
        videoLayer.removeAttribute('src');
        videoLayer.load();
    }
    
    // Set Pixiv Image on dedicated layer
    if (imageLayer) {
        imageLayer.style.backgroundImage = `url('${imageUrl}')`;
        imageLayer.style.display = 'block';
    }

    // Update Overlay
    updatePixivDim();

    // Reset body background
    document.body.style.backgroundImage = 'none';

    appendLog(`[PIXIV] Applied: ${illust.title} by ${illust.user}`);
    savePixivState(); // Update index in Python
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
    
    if (favModeActive && pixivFavorites.length > 0) {
        pixivCurrentIndex = (pixivCurrentIndex + 1) % pixivFavorites.length;
        applySpecificBackground(pixivFavorites[pixivCurrentIndex]);
    } else if (pixivRankings.length > 0) {
        pixivCurrentIndex = (pixivCurrentIndex + 1) % pixivRankings.length;
        applyPixivBackground();
    }
    lastPixivAction = Date.now();
}

function applySpecificBackground(illust) {
    if (!illust) return;
    const imageUrl = illust.url;
    const imageLayer = document.getElementById('bg-layer-image');
    if (imageLayer) {
        imageLayer.style.backgroundImage = `url('${imageUrl}')`;
        imageLayer.style.display = 'block';
    }
    updatePixivDim();
    document.body.style.backgroundImage = 'none';
    appendLog(`[FAVORITE] Applied: ${illust.title}`);
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
function renderPixivGallery() {
    const grid = document.getElementById('gallery-grid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    // Determine which list to show in gallery
    const displayList = favModeActive ? pixivFavorites : pixivRankings;

    displayList.forEach((illust, index) => {
        const isFav = pixivFavorites.some(f => f.url === illust.url);
        const item = document.createElement('div');
        const activeUrl = document.getElementById('bg-layer-image').style.backgroundImage.replace(/url\(['"](.+)['"]\)/, '$1');
        item.className = 'gallery-item' + (illust.url === activeUrl ? ' active' : '');
        
        item.innerHTML = `
            <img src="${illust.thumb}" loading="lazy">
            <div class="gallery-remove-btn">X</div>
            <div class="gallery-fav-btn ${isFav ? 'is-fav' : ''}">${isFav ? '♥' : '♡'}</div>
            <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); padding: 2px 5px; font-size: 9px;" class="white col">
                ${illust.title}
            </div>
        `;
        
        // Manual Select
        item.onclick = (e) => {
            e.stopPropagation();
            pixivCurrentIndex = index;
            pixivManualMode = true;
            
            if (favModeActive) {
                applySpecificBackground(illust);
            } else {
                applyPixivBackground();
            }
            renderPixivGallery();
        };

        // Favorite Toggle
        const favBtn = item.querySelector('.gallery-fav-btn');
        favBtn.onclick = (e) => {
            e.stopPropagation();
            const existingIndex = pixivFavorites.findIndex(f => f.url === illust.url);
            const isActive = illust.url === activeUrl;

            if (existingIndex > -1) {
                // Remove from favorites
                pixivFavorites.splice(existingIndex, 1);
                
                // If we are in Favs Mode and just removed the active background, cycle to next
                if (favModeActive && isActive) {
                    if (pixivFavorites.length > 0) {
                        nextPixivWallpaper();
                    } else {
                        refreshBackground(); // Go back to default if no favs left
                    }
                }
            } else {
                // Add to favorites
                pixivFavorites.push(illust);
            }
            
            saveFavoritesToPython();
            renderPixivGallery();
        };

        // Remove from Gallery / Blacklist
        const removeBtn = item.querySelector('.gallery-remove-btn');
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            const urlToRemove = illust.url;
            pixivBlacklist.add(urlToRemove);
            saveBlacklist();
            
            if (favModeActive) {
                pixivFavorites = pixivFavorites.filter(f => f.url !== urlToRemove);
                saveFavoritesToPython();
            } else {
                pixivRankings = pixivRankings.filter(item => item.url !== urlToRemove);
            }

            renderPixivGallery();
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
        widgetGallery.style.display = isHidden ? 'block' : 'none';
        
        if (isHidden) {
            renderPixivGallery();
            // Position near settings
            const settingsRect = document.getElementById('widget-settings').getBoundingClientRect();
            widgetGallery.style.left = (settingsRect.left - 610) + "px";
            widgetGallery.style.top = settingsRect.top + "px";
        }
    });
}

if (btnCloseGallery) {
    btnCloseGallery.addEventListener('click', () => {
        widgetGallery.style.display = 'none';
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
