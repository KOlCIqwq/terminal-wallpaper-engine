window.pixivEnabled = false;
let pixivRankingType = 'daily';
let pixivCurrentIndex = 0;
let pixivRankings = [];
let pixivUpdateInterval = 60; // minutes
let pixivTimer = null;
let isPixivLoading = false;

function fetchPixivRanking() {
    if (!window.pixivEnabled || isPixivLoading) return;

    isPixivLoading = true;
    appendLog("[PIXIV] Fetching rankings from JSON API...");

    fetch('https://pixiv.mokeyjay.com/?r=api/pixiv-json')
        .then(response => response.json())
        .then(json => {
            isPixivLoading = false;
            
            if (json && json.data && Array.isArray(json.data)) {
                const horizontalRankings = json.data
                    .filter(item => item.width > item.height)
                    .map(item => ({
                        url: `https://pixiv.cat/${item.id}.jpg`,
                        title: item.title,
                        user: item.user_name,
                        link: `https://www.pixiv.net/artworks/${item.id}`
                    }));

                if (horizontalRankings.length > 0) {
                    pixivRankings = horizontalRankings;
                    pixivCurrentIndex = 0;
                    appendLog(`[PIXIV] Found ${pixivRankings.length} horizontal high-res wallpapers.`);
                    applyPixivBackground();
                } else {
                    appendLog("[PIXIV] No horizontal images found in ranking. Trying alternative...");
                    fetchAlternativeRanking();
                }
            } else {
                appendLog("[PIXIV] Invalid JSON structure. Trying alternative...");
                fetchAlternativeRanking();
            }
        })
        .catch(error => {
            isPixivLoading = false;
            console.error("Pixiv JSON fetch error:", error);
            appendLog("[PIXIV] API Error: " + error.message);
            fetchAlternativeRanking();
        });
}

function fetchAlternativeRanking() {
    isPixivLoading = true;
    appendLog("[PIXIV] Trying alternative source...");
    
    fetch('https://api.lolicon.app/setu/v2?r18=0&num=50')
        .then(response => response.json())
        .then(data => {
            isPixivLoading = false;
            if (data && data.data) {
                const horizontalFallback = data.data
                    .filter(item => item.width > item.height)
                    .map(item => ({
                        url: item.urls.original.replace('i.pximg.net', 'i.pixiv.cat'),
                        title: item.title,
                        user: item.author,
                        link: `https://www.pixiv.net/artworks/${item.pid}`
                    }));

                if (horizontalFallback.length > 0) {
                    pixivRankings = horizontalFallback;
                    pixivCurrentIndex = 0;
                    applyPixivBackground();
                    appendLog(`[PIXIV] Found ${pixivRankings.length} high-res fallbacks.`);
                } else {
                    appendLog("[PIXIV] No horizontal images in fallback.");
                }
            }
        })
        .catch(error => {
            isPixivLoading = false;
            appendLog("[PIXIV] Alternative source failed.");
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
}

function startPixivTimer() {
    if (pixivTimer) clearInterval(pixivTimer);
    if (window.pixivEnabled && pixivUpdateInterval > 0) {
        pixivTimer = setInterval(nextPixivWallpaper, pixivUpdateInterval * 60 * 1000);
    }
}

window.myPropertyHandlers = window.myPropertyHandlers || [];
window.myPropertyHandlers.push(function(properties) {
    let shouldFetch = false;

    if (properties.pixiv_enabled !== undefined) {
        const newValue = properties.pixiv_enabled.value;
        if (newValue && !window.pixivEnabled) {
            shouldFetch = true;
        } else if (!newValue) {
            if (pixivTimer) clearInterval(pixivTimer);
            // Re-trigger script.js background logic if needed
            if (typeof window.wallpaperPropertyListener !== 'undefined') {
                // This is a bit hacky, but script.js will re-evaluate based on pixivEnabled being false
            }
        }
        window.pixivEnabled = newValue;
    }

    if (properties.pixiv_update_interval !== undefined) {
        pixivUpdateInterval = properties.pixiv_update_interval.value;
        if (window.pixivEnabled) startPixivTimer();
    }

    if (shouldFetch && window.pixivEnabled) {
        fetchPixivRanking();
        startPixivTimer();
    }
    
    if (properties.bg_dim !== undefined && window.pixivEnabled && pixivRankings.length > 0) {
        updatePixivDim();
    }
});
