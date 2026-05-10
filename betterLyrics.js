/**
 * Parses TTML time strings into decimal seconds.
 * Handles "HH:MM:SS.mmm", "M:SS.mmm", and "SS.mmm"
 */
function parseTTMLTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    let seconds = 0;

    if (parts.length === 3) {
        seconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
        seconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
    } else {
        seconds = parseFloat(parts[0]);
    }
    
    return seconds; // Kept as decimal seconds to match your main app's sync logic
}

function parseTTML(ttmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(ttmlString, 'text/xml');
    const result = [];

    result.push({ time: 0, text: ' ' });

    doc.querySelectorAll('p').forEach(p => {
        const fullLineText = p.textContent || "";
        const words = []; 
        
        let lastWordRef = null; // Track the last word so we can attach spaces to it

        // Recursively collect spans, tracking text and syllables
        function collectSpans(element, isBackground = false) {
            element.childNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'span') {
                    const isBg = isBackground || node.getAttribute('ttm:role') === 'x-bg';
                    const begin = node.getAttribute('begin');

                    if (begin) {
                        const newWord = {
                            text: node.textContent, // e.g., "Me"
                            time: parseTTMLTimeToSeconds(begin),
                            isBackground: isBg
                        };
                        words.push(newWord);
                        lastWordRef = newWord; // Update the reference
                    } else {
                        // Wrapper span, recurse
                        collectSpans(node, isBg);
                    }
                } 
                else if (node.nodeType === Node.TEXT_NODE) {
                    // Capture the spaces/punctuation between spans and glue them to the previous word
                    if (lastWordRef) {
                        lastWordRef.text += node.textContent; 
                    }
                }
            });
        }

        collectSpans(p);

        const lineBeginTime = p.getAttribute('begin');
        
        // Only add non-empty lines
        if (lineBeginTime && fullLineText.trim() !== "") {
            result.push({
                time: parseTTMLTimeToSeconds(lineBeginTime),
                text: fullLineText.trim(), // Clean start/end spaces, but keep internal spaces
                words: words 
            });
        }
    });

    // Add your UI end padding
    result.push({ time: 9999, text: ' ' });
    return result;
}

async function fetchBetterLyricsAPI(title, artist, durationSeconds = -1) {
    const params = new URLSearchParams({
        s: title,
        a: artist
    });

    if (durationSeconds !== -1 || durationSeconds != 0) {
        params.append("d", Math.floor(durationSeconds));
    }

    const url = `https://lyrics-api.boidu.dev/getLyrics?${params.toString()}`;
    console.log(`[Better Lyrics] Fetching: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Better Lyrics HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    // Check for Primary TTML format
    if (data.ttml) {
        const result = parseTTML(data.ttml);
        result.isSynced = true; // explicitly tag it as synced
        return result;
    } 
    // Check for Fallback Kugou format (Standard LRC)
    else if (data.lyrics && typeof parseLRC === 'function') {
        const result = parseLRC(data.lyrics);
        result.isSynced = true;
        return result;
    }

    throw new Error("No valid sync format returned from Better Lyrics");
}