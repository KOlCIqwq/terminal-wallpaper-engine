// --- Clock Widget Logic ---
let clock1City = localStorage.getItem('clock1City') || "";
let clock1Tz = localStorage.getItem('clock1Tz') || "";
let clock2City = localStorage.getItem('clock2City') || "";
let clock2Tz = localStorage.getItem('clock2Tz') || "";
let use24hFormat = false;

window.clock1Coords = JSON.parse(localStorage.getItem('clock1Coords')) || null;
window.clock2Coords = JSON.parse(localStorage.getItem('clock2Coords')) || null;

function fetchTimezoneForClock(cityName, clockNum) {
    if (!cityName || cityName.trim() === "") {
        if (clockNum === 1) { 
            clock1City = ""; clock1Tz = ""; window.clock1Coords = null; 
            localStorage.removeItem('clock1City'); localStorage.removeItem('clock1Tz'); localStorage.removeItem('clock1Coords'); 
        }
        if (clockNum === 2) { 
            clock2City = ""; clock2Tz = ""; window.clock2Coords = null; 
            localStorage.removeItem('clock2City'); localStorage.removeItem('clock2Tz'); localStorage.removeItem('clock2Coords'); 
        }
        if (typeof renderGlobe === 'function' && typeof position !== 'undefined') renderGlobe(position.lon, position.lat);
        return;
    }
    
    fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`)
        .then(res => res.json())
        .then(data => {
            if (data.results && data.results.length > 0 && data.results[0].timezone) {
                const loc = data.results[0];
                const tz = loc.timezone;
                const validName = loc.name; 
                const coords = { lon: loc.longitude, lat: loc.latitude };
                
                if (clockNum === 1) {
                    clock1City = validName; clock1Tz = tz; window.clock1Coords = coords;
                    localStorage.setItem('clock1City', validName); 
                    localStorage.setItem('clock1Tz', tz);
                    localStorage.setItem('clock1Coords', JSON.stringify(coords));
                } else {
                    clock2City = validName; clock2Tz = tz; window.clock2Coords = coords;
                    localStorage.setItem('clock2City', validName); 
                    localStorage.setItem('clock2Tz', tz);
                    localStorage.setItem('clock2Coords', JSON.stringify(coords));
                }

                if (typeof renderGlobe === 'function' && typeof position !== 'undefined') {
                    renderGlobe(position.lon, position.lat);
                }
            }
        })
        .catch(err => console.log("Clock Fetch Offline", err));
}

let lastWeatherHour = -1;
let lastWeatherMinute = -1;

setInterval(() => {
    const now = new Date();

    const timeOpts = { hour12: !use24hFormat };
    const clockEl = document.getElementById('clock');
    const dateEl = document.getElementById('date');
    if (clockEl) clockEl.textContent = now.toLocaleTimeString([], timeOpts);
    if (dateEl) dateEl.textContent = now.toLocaleDateString();

    const localLabel = "[LOCAL]".padEnd(22, ' ').replace(/ /g, ' ');
    const localLabelEl = document.getElementById('local-clock-label');
    if (localLabelEl) localLabelEl.textContent = localLabel;

    const updateWorldClock = (rowId, labelId, dateId, timeId, name, tz) => {
        const row = document.getElementById(rowId);
        if (!row) return;
        if (name && tz) {
            try {
                const tzTimeOpts = { timeZone: tz, hour12: !use24hFormat };
                const timeStr = now.toLocaleTimeString([], tzTimeOpts);
                const dateStr = now.toLocaleDateString([], { timeZone: tz });
                
                const rawLabel = `[${name.toUpperCase()}]`;
                const paddedLabel = rawLabel.padEnd(22, ' ').replace(/ /g, ' ');
                
                document.getElementById(labelId).textContent = paddedLabel;
                document.getElementById(dateId).textContent = dateStr;
                document.getElementById(timeId).textContent = timeStr;
                
                row.style.display = "block";
            } catch (e) {
                row.style.display = "none";
            }
        } else {
            row.style.display = "none";
        }
    };

    updateWorldClock('extra-clock-1-row', 'extra-clock-1-label', 'extra-clock-1-date', 'extra-clock-1-time', clock1City, clock1Tz);
    updateWorldClock('extra-clock-2-row', 'extra-clock-2-label', 'extra-clock-2-date', 'extra-clock-2-time', clock2City, clock2Tz);

    // refresh the weather at each hour
    if (now.getMinutes() != lastWeatherMinute) {
        lastWeatherMinute = now.getMinutes();
        if (now.getHours() !== lastWeatherHour) {
            if (typeof position !== 'undefined' && position.lon && position.lat && typeof getWeather === 'function') {
                getWeather(position.lon, position.lat);
                lastWeatherHour = now.getHours();
            }
        }
    }
}, 1000);

window.myPropertyHandlers = window.myPropertyHandlers || [];
window.myPropertyHandlers.push(function(properties) {
    if (properties.clock_1_city) {
        fetchTimezoneForClock(properties.clock_1_city.value, 1);
    }
    if (properties.clock_2_city) {
        fetchTimezoneForClock(properties.clock_2_city.value, 2);
    }
    if (properties.use_24h_format !== undefined) {
        use24hFormat = properties.use_24h_format.value;
    }
});

