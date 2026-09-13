// --- Draggable & Resizable Widget Framework ---
const widgets = document.querySelectorAll('.draggable-widget');
let activeWidget = null;
let resizingWidget = null;
let resizeDir = '';
let startX, startY, initialLeft, initialTop, initialWidth, initialHeight, initialScale;
let isTicking = false;

// Initial spacing for brand new loads
let defaultTop = 40;

// Load saved positions for all widgets
widgets.forEach((widget) => {
    const savedPos = localStorage.getItem('pos_' + widget.id);
    if (savedPos) {
        const pos = JSON.parse(savedPos);
        widget.style.left = pos.left;
        widget.style.top = pos.top;
        if (pos.scale) {
            widget.style.transform = `scale(${pos.scale})`;
            widget.dataset.scale = pos.scale;
        } else {
            widget.dataset.scale = 1;
        }
        widget.style.transformOrigin = 'top left';
        widget.style.width = "";
        widget.style.height = "";
    } else {
        widget.style.left = "40px";
        widget.style.top = defaultTop + "px";
        widget.dataset.scale = 1;
        widget.style.transformOrigin = 'top left';
        defaultTop += 220;
    }

    widget.addEventListener('mousemove', (e) => {
        if (!document.body.classList.contains('edit-mode-active')) {
            widget.style.cursor = '';
            return;
        }
        if (resizingWidget) return;

        const rect = widget.getBoundingClientRect();
        const edgeSize = 10;
        let dir = '';
        if (e.clientY - rect.top <= edgeSize) dir += 'n';
        if (e.clientY - rect.top >= rect.height - edgeSize) dir += 's';
        if (e.clientX - rect.left <= edgeSize) dir += 'w';
        if (e.clientX - rect.left >= rect.width - edgeSize) dir += 'e';

        if (dir) {
            widget.style.cursor = dir + '-resize';
        } else {
            widget.style.cursor = 'grab';
        }
    });

    widget.addEventListener('mouseleave', () => {
        if (!resizingWidget) widget.style.cursor = '';
    });

    widget.addEventListener('mousedown', (e) => {
        // locked mode
        if (!document.body.classList.contains('edit-mode-active')) return;

        const rect = widget.getBoundingClientRect();
        const edgeSize = 10;
        let dir = '';
        if (e.clientY - rect.top <= edgeSize) dir += 'n';
        if (e.clientY - rect.top >= rect.height - edgeSize) dir += 's';
        if (e.clientX - rect.left <= edgeSize) dir += 'w';
        if (e.clientX - rect.left >= rect.width - edgeSize) dir += 'e';

        widgets.forEach(w => w.style.zIndex = 100);
        widget.style.zIndex = 1000;

        startX = e.clientX;
        startY = e.clientY;
        initialLeft = rect.left;
        initialTop = rect.top;
        initialWidth = rect.width;
        initialHeight = rect.height;
        initialScale = parseFloat(widget.dataset.scale) || 1;

        if (dir) {
            resizingWidget = widget;
            resizeDir = dir;
            return;
        }

        activeWidget = widget;
    });
});

// Move or resize the widget
document.addEventListener('mousemove', (e) => {
    if (!activeWidget && !resizingWidget) return;

    if (!isTicking) {
        window.requestAnimationFrame(() => {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            if (activeWidget) {
                activeWidget.style.left = `${initialLeft + dx}px`;
                activeWidget.style.top = `${initialTop + dy}px`;
            } else if (resizingWidget) {
                let scaleFactor = 1;

                if (resizeDir.includes('e')) {
                    scaleFactor = (initialWidth + dx) / initialWidth;
                } else if (resizeDir.includes('w')) {
                    scaleFactor = (initialWidth - dx) / initialWidth;
                } else if (resizeDir.includes('s')) {
                    scaleFactor = (initialHeight + dy) / initialHeight;
                } else if (resizeDir.includes('n')) {
                    scaleFactor = (initialHeight - dy) / initialHeight;
                }

                let newScale = initialScale * scaleFactor;
                if (newScale < 0.2) newScale = 0.2;
                if (newScale > 5) newScale = 5;

                scaleFactor = newScale / initialScale;

                resizingWidget.style.transform = `scale(${newScale})`;
                resizingWidget.dataset.scale = newScale;

                if (resizeDir.includes('w')) {
                    let newScaledWidth = initialWidth * scaleFactor;
                    let newLeft = initialLeft + (initialWidth - newScaledWidth);
                    resizingWidget.style.left = `${newLeft}px`;
                }
                if (resizeDir.includes('n')) {
                    let newScaledHeight = initialHeight * scaleFactor;
                    let newTop = initialTop + (initialHeight - newScaledHeight);
                    resizingWidget.style.top = `${newTop}px`;
                }
            }

            isTicking = false;
        });
        isTicking = true;
    }
});

// Save the position
window.addEventListener('mouseup', () => {
    const targetWidget = activeWidget || resizingWidget;
    if (targetWidget) {
        localStorage.setItem('pos_' + targetWidget.id, JSON.stringify({
            left: targetWidget.style.left,
            top: targetWidget.style.top,
            scale: targetWidget.dataset.scale || 1
        }));
        activeWidget = null;
        resizingWidget = null;
        resizeDir = '';
    }
});

document.addEventListener('mouseleave', () => {
    activeWidget = null;
    resizingWidget = null;
});

function resetAllWidgets() {
    let resetTop = 40;
    const allWidgets = document.querySelectorAll('.draggable-widget');

    allWidgets.forEach((widget) => {
        widget.style.left = "40px";
        widget.style.top = resetTop + "px";
        widget.style.width = "";
        widget.style.height = "";
        widget.style.transform = "";
        widget.dataset.scale = 1;
        resetTop += 220;

        localStorage.removeItem('pos_' + widget.id);
    });
}

window.resetAllWidgets = resetAllWidgets;

// Property handlers for layout reset and edit mode
let lastResetToggleValue = null;
window.myPropertyHandlers = window.myPropertyHandlers || [];
window.myPropertyHandlers.push(function(properties) {
    if (properties.edit_mode !== undefined) {
        if (properties.edit_mode.value) {
            document.body.classList.add('edit-mode-active');
        } else {
            document.body.classList.remove('edit-mode-active');
        }
    }

    if (properties.reset_layout) {
        let currentValue = properties.reset_layout.value;
        if (lastResetToggleValue === null) {
            lastResetToggleValue = currentValue;
        } else if (currentValue !== lastResetToggleValue) {
            resetAllWidgets();
            lastResetToggleValue = currentValue;
        }
    }
});

