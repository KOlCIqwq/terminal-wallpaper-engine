function getLyrics(title, artist){
    const params = new URLSearchParams({
        artist_name: artist,
        track_name: title
    });
    fetch(`https://lrclib.net/api/get?${params.toString()}`)
        .then(response => {
            if (!response.ok) throw new Error("Lyrics not found or Server down");
            return response.json();
        })
        .then(data => {
            if (data.instrumental) {
                console.log("Instrumental track");
                return;
            }
        
            if (!data.syncedLyrics) {
                console.log("No synced lyrics available");
                return;
            }
            const synced = data.syncedLyrics;
            console.log(synced);
        })
        .catch(err => console.error(err));
}