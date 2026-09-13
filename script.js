// --- Core Engine & Property Coordinator ---
window.charFilled = '|';
window.charEmpty = '·';

// Global logger
const logQueue = [];
function appendLog(msg) {
    logQueue.push(msg);
    if (logQueue.length > 10) {
        logQueue.shift();
    }
    
    const listContainer = document.getElementById("log-list");
    if (listContainer) {
        listContainer.innerHTML = logQueue.map(m => `<div>> ${m}</div>`).join('');
    }
    
    const sysLogText = document.getElementById("log_text");
    if (sysLogText && !(window.overrides && window.overrides.log)) {
        sysLogText.textContent = msg;
    }
}
window.appendLog = appendLog;

// Weather coordinate inputs
const userLocation = {
    city: "",
    lat: "",
    lon: ""
};

window.position = window.position || {
    lat: null,
    lon: null
};

// Global Wallpaper Engine property listener dispatch registry
window.myPropertyHandlers = window.myPropertyHandlers || [];

if (!window.wallpaperPropertyListener) {
    window.wallpaperPropertyListener = {
        applyUserProperties: function(properties) {
            window.myPropertyHandlers.forEach(handler => handler(properties));
        }
    };
}

// Master UI & Theme Property Handler
window.myPropertyHandlers.push(function(properties) {
    const root = document.documentElement;

    // Toggle Widget Titles
    if (properties.show_widget_titles !== undefined) {
        const visibility = properties.show_widget_titles.value ? 'visible' : 'hidden';
        document.querySelectorAll('.title-text').forEach(el => {
            el.style.display = '';
            el.style.visibility = visibility;
        });
    }

    // Toggle Widget Separators
    if (properties.show_widget_separators !== undefined) {
        const visibility = properties.show_widget_separators.value ? 'visible' : 'hidden';
        document.querySelectorAll('.divider-text').forEach(el => {
            el.style.display = '';
            el.style.visibility = visibility;
        });
    }

    // Controls the toggle of each widget
    const toggleWidget = (property, elementId) => {
        if (property !== undefined) {
            const widget = document.getElementById(elementId);
            if (widget) {
                widget.style.display = property.value ? "" : "none";
            }
        }
    };

    toggleWidget(properties.show_sys, 'widget-sys');
    toggleWidget(properties.show_weather, 'widget-weather');
    toggleWidget(properties.show_vis, 'widget-vis');
    toggleWidget(properties.show_media, 'widget-media');
    toggleWidget(properties.show_ascii, 'widget-ascii');
    toggleWidget(properties.show_lyrics, 'widget-lyrics');
    toggleWidget(properties.show_map, 'widget-map');
    toggleWidget(properties.show_logs, 'widget-logs');
    toggleWidget(properties.show_radar_map, 'widget-weather-radar');

    // Weather Location Settings
    let shouldUpdateWeather = false;
    if (properties.city_name) {
        userLocation.city = String(properties.city_name.value).trim();
        shouldUpdateWeather = true;
    }
    if (properties.longitude) {
        userLocation.lon = String(properties.longitude.value).trim();
        shouldUpdateWeather = true;
    }
    if (properties.latitude) {
        userLocation.lat = String(properties.latitude.value).trim();
        shouldUpdateWeather = true;
    }

    if (shouldUpdateWeather) {
        if (userLocation.lat !== "" && userLocation.lon !== "") {
            window.position.lat = userLocation.lat;
            window.position.lon = userLocation.lon;
            if (typeof getWeather === 'function') getWeather(window.position.lon, window.position.lat);
        } else if (userLocation.city !== "") {
            if (typeof updateLocationAndWeather === 'function') updateLocationAndWeather(userLocation.city);
        } else {
            const tw = document.getElementById("today-weather");
            if (tw) tw.innerText = "[ No location provided ]";
        }
    }

    // Theme & Styling Colors
    const parseWeColor = (val) => val.split(' ').map(c => Math.round(parseFloat(c) * 255)).join(', ');
    const parseWeHex = (val) => `rgb(${parseWeColor(val)})`;

    if (properties.widget_bg_color) {
        root.style.setProperty('--widget-bg-rgb', parseWeColor(properties.widget_bg_color.value));
    }
    if (properties.widget_bg_opacity) {
        root.style.setProperty('--widget-bg-opacity', properties.widget_bg_opacity.value / 100);
    }
    
    window.userThemeColors = window.userThemeColors || {};
    if (window.useCustomColors === undefined) window.useCustomColors = false;

    if (properties.use_custom_colors !== undefined) {
        window.useCustomColors = properties.use_custom_colors.value;
        if (window.useCustomColors) {
            if (window.userThemeColors.white) {
                root.style.setProperty('--text-white', window.userThemeColors.white);
                root.style.setProperty('--text-main', window.userThemeColors.white);
            }
            if (window.userThemeColors.header) {
                root.style.setProperty('--text-header', window.userThemeColors.header);
            }
            root.style.setProperty('text-shadow', 'none'); 
        } else {
            if (typeof window.reapplyDynamicColors === 'function') {
                window.reapplyDynamicColors();
            }
        }
    }

    if (properties.color_white) {
        window.userThemeColors.white = parseWeHex(properties.color_white.value);
        if (window.useCustomColors) {
            root.style.setProperty('--text-white', window.userThemeColors.white);
            root.style.setProperty('--text-main', window.userThemeColors.white);
        }
    }
    
    if (properties.color_yellow) root.style.setProperty('--text-yellow', parseWeHex(properties.color_yellow.value));
    if (properties.color_blue) root.style.setProperty('--text-blue', parseWeHex(properties.color_blue.value));
    if (properties.color_green) root.style.setProperty('--text-green', parseWeHex(properties.color_green.value));
    if (properties.color_gray) root.style.setProperty('--text-gray', parseWeHex(properties.color_gray.value));

    if (properties.color_header) {
        window.userThemeColors.header = parseWeHex(properties.color_header.value);
        if (window.useCustomColors) {
            root.style.setProperty('--text-header', window.userThemeColors.header);
        }
    }
    if (properties.color_divider) root.style.setProperty('--text-divider', parseWeHex(properties.color_divider.value));
});
