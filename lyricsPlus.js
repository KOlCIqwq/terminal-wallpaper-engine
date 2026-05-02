const LYRICS_PLUS_ENDPOINTS = [
    "https://lyricsplus.prjktla.workers.dev",
    "https://lyricsplus.binimum.org",
    "https://lyricsplus.atomix.one",
    "https://lyricsplus-seven.vercel.app",
    "https://lyrics-plus-backend.vercel.app"
];


function parseLyricsPlus(jsonResponse) {
    const result = [];
    result.push({ time: 0, text: ' ' }); // Start padding

    if (jsonResponse && jsonResponse.lyrics && Array.isArray(jsonResponse.lyrics)) {
        jsonResponse.lyrics.forEach(line => {
            // Convert milliseconds to seconds
            const lineTimeSec = line.time / 1000; 
            const words = [];

            // Map their 'syllabus' array to our 'words' format
            if (line.syllabus && Array.isArray(line.syllabus)) {
                line.syllabus.forEach(syllable => {
                    words.push({
                        text: syllable.text, 
                        time: syllable.time / 1000
                    });
                });
            }

            // Only add non-empty lines
            if (line.text && line.text.trim() !== "") {
                result.push({
                    time: lineTimeSec,
                    text: line.text,
                    words: words // Seamlessly plugs into our karaoke renderer
                });
            }
        });
    }

    result.push({ time: 9999, text: ' ' }); // End padding
    return result;
}

async function fetchLyricsPlusAPI(title, artist) {
    const params = new URLSearchParams({
        title: title,
        artist: artist,
        source: "apple,lyricsplus,musixmatch,spotify,musixmatch-word"
    });

    const queryStr = params.toString();

    // Try each endpoint in sequence until one succeeds
    for (const baseUrl of LYRICS_PLUS_ENDPOINTS) {
        const url = `${baseUrl}/v2/lyrics/get?${queryStr}`;
        console.log(`[Lyrics Plus] Trying: ${url}`);
        
        try {
            const response = await fetch(url);
            
            if (response.ok) {
                const data = await response.json();
                
                // Ensure we actually got a lyrics array back
                if (data && data.lyrics && data.lyrics.length > 0) {
                    console.log(`[Lyrics Plus] Success on: ${baseUrl}`);
                    return parseLyricsPlus(data);
                }
            }
        } catch (err) {
            // Silently fail this endpoint and let the loop try the next one
            console.log(`[Lyrics Plus] Endpoint failed: ${baseUrl}`);
        }
    }

    throw new Error("All Lyrics Plus endpoints failed or returned no sync data.");
}