function getWeather(lon,lat){
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        daily: "weather_code",
        hourly: "temperature_2m,precipitation",
        timezone: "auto"
    })
    fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
    .then(response =>{
        if (!response.ok) throw new Error("Cannot fetch weather");
        return response.json();
    })
    .then(data => {
        const currentHour = new Date();
        currentHour.setMinutes(0, 0, 0);

        let startIndex = data.hourly.time.findIndex(t => new Date(t).getTime() >= currentHour.getTime());
        if (startIndex === -1) startIndex = 0;

        let today = parseWeather(data.daily.weather_code[0]);
        let nowTemp = Math.round(data.hourly.temperature_2m[startIndex - 1]);
        let nowPrecip = data.hourly.precipitation[startIndex - 1];
        let nowTimeStr = new Date(data.hourly.time[startIndex - 1]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        document.getElementById("today-weather").innerText = `[ ${today.icon} ${today.desc}; ${nowTimeStr}: ${nowTemp}°C / ${nowPrecip}mm]`;

        if (startIndex === -1) startIndex = 0;

        let hourlyBlocks = [];
        for (let i = startIndex; i < startIndex + 4; i++) {
            let timeStr = new Date(data.hourly.time[i]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            let temp = Math.round(data.hourly.temperature_2m[i]);
            let precip = data.hourly.precipitation[i];
            
            // Example format: 14:00 15°C/0mm
            hourlyBlocks.push(`${timeStr}: ${temp}°C / ${precip}mm`);
        }
        document.getElementById("hourly-weather").innerText = `[ ${hourlyBlocks.join(" | ")} ]`;

        let iconHTML = "";
        let dateHTML = "";

        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

        for (let i = 1; i < 6; i++){
            let weather = parseWeather(data.daily.weather_code[i]);

            let [y, m, d] = data.daily.time[i].split('-');
            let forecastDate = new Date(y, m - 1, d); 
            let dayName = days[forecastDate.getDay()];
            let dateStr = `${d}/${m}`;

            let cellStyle = `display: inline-block; width: 130px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom;`;

            iconHTML += `<span style="${cellStyle}">${weather.icon}  ${weather.desc}</span>`;
            dateHTML += `<span style="${cellStyle}">${dateStr} ${dayName}</span>`;
            
            if (i < 5) {
                iconHTML += " | ";
                dateHTML += " | ";
            }
        }

        document.getElementById("next-weather-icons").innerHTML = `[ ${iconHTML} ]`;
        document.getElementById("next-weather-dates").innerHTML = `[ ${dateHTML} ]`;
    })
    .catch(error => {
        document.getElementById("today-weather").innerText = "Error loading weather";
    });
}

function updateLocationAndWeather(cityName) {
    if (!cityName || cityName.trim() === "") return;
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;

    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error("Geocoding API error");
            return response.json();
        })
        .then(data => {
            if (data.results && data.results.length > 0) {
                const loc = data.results[0];
                
                position.lat = loc.latitude;
                position.lon = loc.longitude;
                // Change city name
                document.getElementById("city-name").innerText = `${cityName}:`;
                getWeather(position.lon, position.lat);
            } else {
                document.getElementById("today-weather").innerText = `[ Error: City '${cityName}' not found ]`;
            }
        })
        .catch(error => {
            console.error(error);
            document.getElementById("today-weather").innerText = "[ Error resolving city ]";
        });
}

function parseWeather(code) {
    const wwMap = {
        0:  { desc: "Sky Clear", icon: "☀️" },
        1:  { desc: "Clearing Clouds", icon: "🌤️" },
        2:  { desc: "Stable Sky", icon: "⛅" },
        3:  { desc: "Cloud Forming", icon: "☁️" },
        4:  { desc: "Smoke", icon: "🌫️" },
        5:  { desc: "Haze", icon: "🌫️" },
        6:  { desc: "Dust Haze", icon: "🌫️" },
        7:  { desc: "Blowing Dust", icon: "🌬️" },
        8:  { desc: "Dust Whirls", icon: "🌪️" },
        9:  { desc: "Duststorm", icon: "🌪️" },

        10: { desc: "Mist", icon: "🌫️" },
        11: { desc: "Shallow Fog", icon: "🌫️" },
        12: { desc: "Continuous Fog", icon: "🌫️" },
        13: { desc: "Distant Lightning", icon: "🌩️" },
        14: { desc: "Virga", icon: "🌧️" },
        15: { desc: "Distant Rain", icon: "🌧️" },
        16: { desc: "Nearby Rain", icon: "🌧️" },
        17: { desc: "Dry Thunderstorm", icon: "⛈️" },
        18: { desc: "Squalls", icon: "🌬️" },
        19: { desc: "Funnel Cloud", icon: "🌪️" },

        20: { desc: "Recent Drizzle", icon: "🌦️" },
        21: { desc: "Recent Rain", icon: "🌧️" },
        22: { desc: "Recent Snow", icon: "❄️" },
        23: { desc: "Mixed Precipitation", icon: "🌨️" },
        24: { desc: "Freezing Precipitation", icon: "🌧️" },
        25: { desc: "Recent Showers", icon: "🌦️" },
        26: { desc: "Recent Snow Showers", icon: "🌨️" },
        27: { desc: "Recent Hail", icon: "🌨️" },
        28: { desc: "Recent Fog", icon: "🌫️" },
        29: { desc: "Recent Thunderstorm", icon: "⛈️" },

        30: { desc: "Weak Duststorm", icon: "🌪️" },
        31: { desc: "Stable Duststorm", icon: "🌪️" },
        32: { desc: "Increasing Duststorm", icon: "🌪️" },
        33: { desc: "Severe Duststorm", icon: "🌪️" },
        34: { desc: "Stable Severe Duststorm", icon: "🌪️" },
        35: { desc: "Intensifying Duststorm", icon: "🌪️" },
        36: { desc: "Low Blowing Snow", icon: "❄️" },
        37: { desc: "Heavy Drifting Snow", icon: "❄️" },
        38: { desc: "High Blowing Snow", icon: "❄️" },
        39: { desc: "Heavy Blowing Snow", icon: "❄️" },

        40: { desc: "Distant Fog", icon: "🌫️" },
        41: { desc: "Patchy Fog", icon: "🌫️" },
        42: { desc: "Thinning Fog", icon: "🌫️" },
        43: { desc: "Dense Fog", icon: "🌫️" },
        44: { desc: "Persistent Fog", icon: "🌫️" },
        45: { desc: "Thick Fog", icon: "🌫️" },
        46: { desc: "Developing Fog", icon: "🌫️" },
        47: { desc: "Dense Fog", icon: "🌫️" },
        48: { desc: "Rime Fog", icon: "🌫️" },
        49: { desc: "Dense Rime Fog", icon: "🌫️" },

        50: { desc: "Light Drizzle", icon: "🌦️" },
        51: { desc: "Light Drizzle", icon: "🌦️" },
        52: { desc: "Moderate Drizzle", icon: "🌦️" },
        53: { desc: "Moderate Drizzle", icon: "🌦️" },
        54: { desc: "Heavy Drizzle", icon: "🌧️" },
        55: { desc: "Heavy Drizzle", icon: "🌧️" },
        56: { desc: "Freezing Drizzle", icon: "🌧️" },
        57: { desc: "Heavy Freezing Drizzle", icon: "🌧️" },
        58: { desc: "Light Mixed Rain", icon: "🌦️" },
        59: { desc: "Heavy Mixed Rain", icon: "🌧️" },

        60: { desc: "Light Rain", icon: "🌧️" },
        61: { desc: "Light Rain", icon: "🌧️" },
        62: { desc: "Moderate Rain", icon: "🌧️" },
        63: { desc: "Moderate Rain", icon: "🌧️" },
        64: { desc: "Heavy Rain", icon: "🌧️" },
        65: { desc: "Heavy Rain", icon: "🌧️" },
        66: { desc: "Freezing Rain", icon: "🌧️" },
        67: { desc: "Heavy Freezing Rain", icon: "🌧️" },
        68: { desc: "Light Rain Snow", icon: "🌨️" },
        69: { desc: "Heavy Rain Snow", icon: "🌨️" },

        70: { desc: "Light Snow", icon: "❄️" },
        71: { desc: "Light Snow", icon: "❄️" },
        72: { desc: "Moderate Snow", icon: "❄️" },
        73: { desc: "Moderate Snow", icon: "❄️" },
        74: { desc: "Heavy Snow", icon: "❄️" },
        75: { desc: "Heavy Snow", icon: "❄️" },
        76: { desc: "Diamond Dust", icon: "❄️" },
        77: { desc: "Snow Grains", icon: "❄️" },
        78: { desc: "Ice Crystals", icon: "❄️" },
        79: { desc: "Ice Pellets", icon: "🌨️" },

        80: { desc: "Light Rain Showers", icon: "🌦️" },
        81: { desc: "Heavy Rain Showers", icon: "🌧️" },
        82: { desc: "Violent Showers", icon: "🌧️" },
        83: { desc: "Light Mixed Showers", icon: "🌨️" },
        84: { desc: "Heavy Mixed Showers", icon: "🌨️" },
        85: { desc: "Light Snow Showers", icon: "🌨️" },
        86: { desc: "Heavy Snow Showers", icon: "🌨️" },
        87: { desc: "Light Small Hail", icon: "🌨️" },
        88: { desc: "Heavy Small Hail", icon: "🌨️" },
        89: { desc: "Light Hail", icon: "🌨️" },
        90: { desc: "Heavy Hail", icon: "🌨️" },
        91: { desc: "Light Rain Thunder", icon: "⛈️" },
        92: { desc: "Heavy Rain Thunder", icon: "⛈️" },
        93: { desc: "Light Snow Thunder", icon: "⛈️" },
        94: { desc: "Heavy Snow Thunder", icon: "⛈️" },
        95: { desc: "Thunderstorm", icon: "⛈️" },
        96: { desc: "Hail Thunderstorm", icon: "⛈️" },
        97: { desc: "Severe Thunderstorm", icon: "⛈️" },
        98: { desc: "Dust Thunderstorm", icon: "⛈️" },
        99: { desc: "Severe Hail Thunderstorm", icon: "⛈️" }
    };

    return wwMap[code] || { desc: "Unknown", icon: "❓" };
}