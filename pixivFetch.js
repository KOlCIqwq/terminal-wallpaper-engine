window.pixivEnabled = false;
let pixivRankingType = 'daily';
let pixivCurrentIndex = 0;
let pixivRankings = [];
let pixivUpdateInterval = 60; // minutes
let pixivShuffle = false;
let isPixivLoading = false;
let lastPixivAction = Date.now();
let pixivManualMode = false;

// Load Blacklist from localStorage
let pixivBlacklist = new Set(JSON.parse(localStorage.getItem('pixiv_blacklist') || "[]"));

function saveBlacklist() {
    localStorage.setItem('pixiv_blacklist', JSON.stringify(Array.from(pixivBlacklist)));
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
        // Fetch 3 pages with size 50 each
        for (let p = 1; p <= 4; p++) {
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
                        .map(item => ({
                            url: `https://pixiv.cat/${item.id}.jpg`,
                            title: item.title,
                            user: (item.user ? item.user.name : "Unknown"),
                            link: `https://www.pixiv.net/artworks/${item.id}`
                        }))
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
                        const originalUrl = item.urls.original || item.urls.regular || "";
                        return {
                            url: originalUrl.replace('i.pximg.net', 'i.pixiv.cat'),
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
    if (!window.pixivEnabled || pixivRankings.length === 0) return;
    pixivCurrentIndex = (pixivCurrentIndex + 1) % pixivRankings.length;
    applyPixivBackground();
    lastPixivAction = Date.now();
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
            const btnNext = document.getElementById('btn-pixiv-next');
            if (btnNext) btnNext.style.display = 'none';
            if (typeof refreshBackground === 'function') refreshBackground();
        }
        window.pixivEnabled = newValue;
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
    pixivRankings.forEach((illust, index) => {
        const item = document.createElement('div');
        item.className = 'gallery-item' + (index === pixivCurrentIndex ? ' active' : '');
        item.innerHTML = `
            <img src="${illust.url}" loading="lazy">
            <div class="gallery-remove-btn">X</div>
            <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); padding: 2px 5px; font-size: 9px;" class="white col">
                ${illust.title}
            </div>
        `;
        
        // Manual Select
        item.onclick = (e) => {
            e.stopPropagation();
            pixivCurrentIndex = index;
            pixivManualMode = true;
            applyPixivBackground();
            renderPixivGallery();
        };

        // Remove from Gallery / Blacklist
        const removeBtn = item.querySelector('.gallery-remove-btn');
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            const urlToRemove = illust.url;
            pixivBlacklist.add(urlToRemove);
            saveBlacklist();
            
            appendLog(`[PIXIV] Blacklisted: ${illust.title}`);
            
            // Filter current array
            pixivRankings = pixivRankings.filter(item => item.url !== urlToRemove);
            
            if (pixivCurrentIndex >= index) {
                pixivCurrentIndex = Math.max(0, pixivCurrentIndex - 1);
            }

            if (illust.url === document.getElementById('bg-layer-image').style.backgroundImage.replace(/url\(['"](.+)['"]\)/, '$1')) {
                nextPixivWallpaper();
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
