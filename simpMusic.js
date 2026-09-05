// simpMusic.js - SimpMusic Lyrics Provider (https://api-lyrics.simpmusic.org)

const SIMPMUSIC_ENDPOINTS = [
    "https://api-lyrics.simpmusic.org"
];

async function fetchSimpMusicLyricsAPI(title, artist, durationSeconds = -1) {
    const query = `${title} ${artist}`.trim();
    const searchUrl = `${SIMPMUSIC_ENDPOINTS[0]}/v1/search?q=${encodeURIComponent(query)}&limit=5`;
    console.log(`[SimpMusic] Searching: ${searchUrl}`);

    const response = await fetch(searchUrl);
    if (!response.ok) {
        throw new Error(`SimpMusic Search HTTP Error: ${response.status}`);
    }

    const searchData = await response.json();
    if (!searchData || !searchData.success || !Array.isArray(searchData.data) || searchData.data.length === 0) {
        throw new Error("No candidates returned from SimpMusic search");
    }

    // Filter by strict artist match to prevent false lyrics
    const candidates = searchData.data.filter(track => {
        if (!track || !track.artistName) return false;
        if (typeof isArtistMatch === 'function') {
            return isArtistMatch(track.artistName, artist);
        }
        return track.artistName.toLowerCase().includes(artist.toLowerCase()) ||
               artist.toLowerCase().includes(track.artistName.toLowerCase());
    });

    if (candidates.length === 0) {
        throw new Error(`SimpMusic: No candidates matched artist "${artist}"`);
    }

    // Try each candidate videoId until we find one with lyrics
    for (const candidate of candidates) {
        if (candidate.syncedLyrics && candidate.syncedLyrics.trim().length > 0) {
            const result = parseLRC(candidate.syncedLyrics);
            result.isSynced = true;
            result.provider = "SimpMusic";
            if (candidate.durationSeconds) result.originalDuration = candidate.durationSeconds;
            return result;
        }

        const videoId = candidate.videoId || candidate.id;
        if (!videoId) continue;

        try {
            const detailUrl = `${SIMPMUSIC_ENDPOINTS[0]}/v1/${encodeURIComponent(videoId)}`;
            console.log(`[SimpMusic] Fetching lyrics for videoId ${videoId}: ${detailUrl}`);
            const detailRes = await fetch(detailUrl);
            if (!detailRes.ok) continue;

            const detailJson = await detailRes.json();
            if (!detailJson || !detailJson.success) continue;

            // Handle data as object or array of objects
            const detailData = Array.isArray(detailJson.data) ? detailJson.data[0] : detailJson.data;
            if (!detailData) continue;

            if (detailData.syncedLyrics && detailData.syncedLyrics.trim().length > 0) {
                const result = parseLRC(detailData.syncedLyrics);
                result.isSynced = true;
                result.provider = "SimpMusic";
                if (detailData.durationSeconds || candidate.durationSeconds) {
                    result.originalDuration = detailData.durationSeconds || candidate.durationSeconds;
                }
                return result;
            }

            if (detailData.plainLyric && detailData.plainLyric.trim().length > 0) {
                const result = detailData.plainLyric.split('\n')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => ({ time: 0, text: line }));
                result.isSynced = false;
                result.sourceName = "SimpMusic";
                return result;
            }
        } catch (e) {
            console.log(`[SimpMusic] Failed detail fetch for ${videoId}:`, e.message);
        }
    }

    throw new Error("SimpMusic: No synced or plain lyrics found across candidates");
}
