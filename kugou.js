// kugou.js

const KUGOU_DURATION_TOLERANCE = 8; // seconds

function normalizeKugouText(text) {
    if (!text) return "";
    
    //let unifiedText = text.replace(/\s*[\(\[]/g, " - ").replace(/[\)\]]/g, "");

    return text.replace(/, /g, "、")
               .replace(/ & /g, "、")
               .replace(/ and /g, "、")
               .replace(/\./g, "")
               .replace(/和/g, "、")
               .replace(/\s+/g, ' ') // Collapse any accidental double spaces
               .trim();
}

function decodeBase64UTF8(str) {
    // Standard JS atob() breaks on non-Latin characters. This safely decodes UTF-8.
    try {
        return decodeURIComponent(atob(str).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
    } catch (e) {
        return atob(str); // Fallback
    }
}

function filterKugouLrc(lrcString) {
    const lines = lrcString.split('\n');
    const acceptedRegex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\].*/;
    const bannedRegex = /.+].+[:：].+/; // Matches metadata like "Singer: John"

    const filtered = lines.filter(line => {
        if (!acceptedRegex.test(line)) return false;
        if (bannedRegex.test(line)) return false; 
        return true;
    });

    return filtered.join('\n');
}

async function fetchKugouLyricsAPI(title, artist, durationSeconds = -1) {
    try {
        const normTitle = normalizeKugouText(title);
        const normArtist = normalizeKugouText(artist);
        const keyword = `${normTitle} ${normArtist}`.trim();

        // Search for the song to get a hash
        const searchUrl = `https://mobileservice.kugou.com/api/v3/search/song?version=9108&plat=0&pagesize=8&showtype=0&keyword=${encodeURIComponent(keyword)}`;
        console.log(searchUrl);
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();

        let targetHash = null;

        if (searchData && searchData.data && searchData.data.info) {
            for (const song of searchData.data.info) {
                if (durationSeconds === -1 || Math.abs(song.duration - durationSeconds) <= KUGOU_DURATION_TOLERANCE) {
                    targetHash = song.hash;
                    break;
                }
            }
        }

        let candidate = null;

        // Fetch lyrics candidate using hash
        if (targetHash) {
            const hashUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${targetHash}`;
            console.log(hashUrl);
            const hashRes = await fetch(hashUrl);
            const hashData = await hashRes.json();
            if (hashData && hashData.candidates && hashData.candidates.length > 0) {
                candidate = hashData.candidates[0];
            }
        }

        // Fallback: Fetch lyrics candidate using keyword
        if (!candidate) {
            let fallbackUrl = `https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(keyword)}`;
            console.log(fallbackUrl);
            if (durationSeconds !== -1) {
                fallbackUrl += `&duration=${Math.floor(durationSeconds * 1000)}`;
            }
            const fbRes = await fetch(fallbackUrl);
            const fbData = await fbRes.json();
            if (fbData && fbData.candidates && fbData.candidates.length > 0) {
                candidate = fbData.candidates[0];
            }
        }

        if (!candidate) return null;

        // Download actual lyrics
        const dlUrl = `https://lyrics.kugou.com/download?fmt=lrc&charset=utf8&client=pc&ver=1&id=${candidate.id}&accesskey=${candidate.accesskey}`;
        console.log(dlUrl);
        const dlRes = await fetch(dlUrl);
        const dlData = await dlRes.json();

        if (dlData && dlData.content) {
            const rawLrc = decodeBase64UTF8(dlData.content);
            return filterKugouLrc(rawLrc);
        }
        
        return null;
    } catch (e) {
        console.error("[KuGou] Network or parse error:", e);
        return null;
    }
}