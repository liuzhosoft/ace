"use strict";

var MouseEvent = require("./mouse_event").MouseEvent;
var event = require("../lib/event");
var dom = require("../lib/dom");

var mode = "scroll";

exports.setMode = function (m) {
    mode = m;
};

exports.addTouchListeners = function(el, editor) {
    var startX;
    var startY;
    var touchStartT;
    var lastT;
    var longTouchTimer;
    var animationTimer;
    var touchScrollTimer;
    var touchScrollEndTimer;
    var touchScrollActive = false;
    var animationSteps = 0;
    var animationElapsed = 0;
    var animationLastT = 0;
    var pendingScrollX = 0;
    var pendingScrollY = 0;
    var initialX;
    var initialY;
    var pos;
    var clickCount = 0;
    var vX = 0;
    var vY = 0;
    var pressed;
    var contextMenu;
    var didLongTap = false;
    var maxFlingVelocity = 5;
    var minFlingVelocity = 0.018;
    var flingFriction = 0.0016;
    var maxFlingDuration = 2200;
    var requestFrame = window.requestAnimationFrame || function(callback) {
        return setTimeout(function() {
            callback(Date.now());
        }, 16);
    };
    var cancelFrame = window.cancelAnimationFrame || clearTimeout;

    if (el.style)
        el.style.touchAction = "none";

    function setTouchScrollExtrasSkipped(renderer, skip) {
        if (!renderer)
            return;
        renderer.$skipTouchScrollExtras = skip;
    }

    function refreshTouchScrollExtras(renderer) {
        var config = renderer.layerConfig;
        if (renderer.$customScrollbar && renderer.$scrollDecorator)
            renderer.$scrollDecorator.$updateDecorators(config);
        if (renderer.$textLayer && renderer.$textLayer.$highlightIndentGuide)
            renderer.$textLayer.$highlightIndentGuide();
        if (renderer.$gutterLayer) {
            if (renderer.$gutterLayer.updateLineHighlight)
                renderer.$gutterLayer.updateLineHighlight();
            if (renderer.$gutterLayer.$updateGutterWidth)
                renderer.$gutterLayer.$updateGutterWidth(config);
        }
        if (renderer.$markerBack)
            renderer.$markerBack.update(config);
        if (renderer.$markerFront)
            renderer.$markerFront.update(config);
        if (renderer.$cursorLayer)
            renderer.$cursorLayer.update(config);
        if (renderer.$selectorLayer)
            renderer.$selectorLayer.update(config);
        if (renderer.$moveTextAreaToCursor)
            renderer.$moveTextAreaToCursor();
    }

    function finishTouchScroll() {
        touchScrollEndTimer = null;
        touchScrollActive = false;
        if (!editor.renderer)
            return;
        setTouchScrollExtrasSkipped(editor.renderer, false);
        refreshTouchScrollExtras(editor.renderer);
    }

    function beginTouchScroll() {
        if (touchScrollEndTimer) {
            clearTimeout(touchScrollEndTimer);
            touchScrollEndTimer = null;
        }
        var wasActive = touchScrollActive;
        touchScrollActive = true;
        setTouchScrollExtrasSkipped(editor.renderer, true);
        if (!wasActive && editor.renderer && editor.renderer.$selectorLayer) {
            editor.renderer.$selectorLayer.hideMidSelectHandle();
            editor.renderer.$selectorLayer.hideLeftRightSelectHandle();
        }
    }

    function endTouchScroll(delay) {
        if (!touchScrollActive)
            return;
        if (touchScrollEndTimer)
            clearTimeout(touchScrollEndTimer);
        touchScrollEndTimer = setTimeout(finishTouchScroll, delay == null ? 80 : delay);
    }

    function cancelAnimation() {
        if (!animationTimer)
            return;
        cancelFrame(animationTimer);
        animationTimer = null;
        animationSteps = 0;
        animationElapsed = 0;
        animationLastT = 0;
        endTouchScroll();
    }

    function getScrollableDelta(x, y) {
        if (x && !editor.renderer.isScrollableBy(x, 0))
            x = 0;
        if (y && !editor.renderer.isScrollableBy(0, y))
            y = 0;
        if (!x && !y)
            return null;
        return {x: x, y: y};
    }

    function scrollByTouch(x, y) {
        var delta = getScrollableDelta(x, y);
        if (!delta)
            return false;
        editor.renderer.scrollBy(delta.x, delta.y);
        return true;
    }

    function applyPendingScroll() {
        touchScrollTimer = null;
        var x = pendingScrollX;
        var y = pendingScrollY;
        pendingScrollX = pendingScrollY = 0;
        if (!x && !y)
            return false;
        return scrollByTouch(x, y);
    }

    function flushPendingScroll() {
        if (touchScrollTimer) {
            cancelFrame(touchScrollTimer);
            touchScrollTimer = null;
        }
        return applyPendingScroll();
    }

    function cancelPendingScroll() {
        if (touchScrollTimer) {
            cancelFrame(touchScrollTimer);
            touchScrollTimer = null;
        }
        pendingScrollX = pendingScrollY = 0;
    }

    function scheduleScrollByTouch(x, y) {
        var delta = getScrollableDelta(x, y);
        if (!delta)
            return false;
        beginTouchScroll();
        pendingScrollX += delta.x;
        pendingScrollY += delta.y;
        if (!touchScrollTimer)
            touchScrollTimer = requestFrame(applyPendingScroll);
        return true;
    }

    function clampVelocity(value) {
        return Math.max(-maxFlingVelocity, Math.min(maxFlingVelocity, value));
    }

    function getEventTime(e) {
        return e.timeStamp || Date.now();
    }

    function updateVelocity(x, y, dt) {
        if (dt <= 0 || dt > 80)
            return;
        var nextX = x / dt;
        var nextY = y / dt;
        var weight = Math.max(0.25, Math.min(0.75, dt / 40));
        vX = vX && nextX && vX * nextX > 0 ? vX * (1 - weight) + nextX * weight : nextX;
        vY = vY && nextY && vY * nextY > 0 ? vY * (1 - weight) + nextY * weight : nextY;
        vX = clampVelocity(vX);
        vY = clampVelocity(vY);
    }
    
    function hasNativeMenu() {
        var nativeEditor = window["AndroidEditor"];
        return nativeEditor && typeof nativeEditor.showContextMenu === "function";
    }
    
    function createContextMenu() {
        var clipboard = window.navigator && window.navigator.clipboard;
        var isOpen = false;
        var updateMenu = function() {
            var selected = editor.getCopyText();
            var hasUndo = editor.session.getUndoManager().hasUndo();
            contextMenu.replaceChild(
                dom.buildDom(isOpen ? ["span",
                    !selected && canExecuteCommand("selectall") && ["span", { class: "ace_mobile-button", action: "selectall" }, "Select All"],
                    selected && canExecuteCommand("copy") && ["span", { class: "ace_mobile-button", action: "copy" }, "Copy"],
                    selected && canExecuteCommand("cut") && ["span", { class: "ace_mobile-button", action: "cut" }, "Cut"],
                    clipboard && canExecuteCommand("paste") && ["span", { class: "ace_mobile-button", action: "paste" }, "Paste"],
                    hasUndo && canExecuteCommand("undo") && ["span", { class: "ace_mobile-button", action: "undo" }, "Undo"],
                    canExecuteCommand("find") && ["span", { class: "ace_mobile-button", action: "find" }, "Find"],
                    canExecuteCommand("openCommandPalette") && ["span", { class: "ace_mobile-button", action: "openCommandPalette" }, "Palette"]
                ] : ["span"]),
                contextMenu.firstChild
            );
        };
        
        var canExecuteCommand = function (/** @type {string} */ cmd) {
            return editor.commands.canExecute(cmd, editor);
        };
        
        var handleClick = function(e) {
            var action = e.target.getAttribute("action");

            if (action == "more" || !isOpen) {
                isOpen = !isOpen;
                return updateMenu();
            }
            if (action == "paste") {
                clipboard.readText().then(function (text) {
                    editor.execCommand(action, text);
                });
            }
            else if (action) {
                if (action == "cut" || action == "copy") {
                    if (clipboard)
                        clipboard.writeText(editor.getCopyText());
                    else
                        document.execCommand("copy");
                }
                editor.execCommand(action);
            }
            contextMenu.firstChild.style.display = "none";
            isOpen = false;
            if (action != "openCommandPalette")
                editor.focus();
        };
        contextMenu = dom.buildDom(["div",
            {
                class: "ace_mobile-menu",
                ontouchstart: function(e) {
                    mode = "menu";
                    e.stopPropagation();
                    e.preventDefault();
                    editor.textInput.focus();
                },
                ontouchend: function(e) {
                    e.stopPropagation();
                    e.preventDefault();
                    handleClick(e);
                },
                onclick: handleClick
            },
            ["span"],
            ["span", { class: "ace_mobile-button", action: "more" }, "..."]
        ], editor.container);
    }

    function showContextMenu(opts) {
        if (hasNativeMenu()) {
            if (opts && typeof opts.clientX === "number" && typeof opts.clientY === "number" && pos) {
                var selectionRange = editor.selection.getRange();
                if (!selectionRange.isEmpty() && selectionRange.contains(pos.row, pos.column)) {
                    var doc = editor.container && editor.container.ownerDocument;
                    var win = doc && doc.defaultView;
                    var scrollLeft = win ? (win.pageXOffset || doc.documentElement.scrollLeft || 0) : 0;
                    var scrollTop = win ? (win.pageYOffset || doc.documentElement.scrollTop || 0) : 0;
                    var x = opts.clientX + scrollLeft;
                    var y = opts.clientY + scrollTop;
                    var layerConfig = editor.renderer && editor.renderer.layerConfig;
                    y -= Math.round(layerConfig && layerConfig.lineHeight ? layerConfig.lineHeight * 2.5 : 30);
                    var rect = editor.container && editor.container.getBoundingClientRect && editor.container.getBoundingClientRect();
                    if (rect && rect.right > rect.left && rect.bottom > rect.top) {
                        var pageLeft = rect.left + scrollLeft;
                        var pageRight = rect.right + scrollLeft;
                        var pageTop = rect.top + scrollTop;
                        var pageBottom = rect.bottom + scrollTop;
                        if (x < pageLeft) x = pageLeft;
                        if (x > pageRight) x = pageRight;
                        if (y < pageTop) y = pageTop;
                        if (y > pageBottom) y = pageBottom;
                    }
                    event.callAndroidEditor("showContextMenu", x, y);
                    editor.off("input", hideContextMenu);
                    editor.on("input", hideContextMenu);
                    return;
                }
            }
            var point = opts && opts.longtap && pos ? pos : editor.selection.getSelectionLead();
            var screen = editor.renderer.textToScreenCoordinates(point.row, point.column);
            var doc = editor.container && editor.container.ownerDocument;
            var win = doc && doc.defaultView;
            var scrollLeft = win ? (win.pageXOffset || doc.documentElement.scrollLeft || 0) : 0;
            var scrollTop = win ? (win.pageYOffset || doc.documentElement.scrollTop || 0) : 0;
            var x = screen.pageX + scrollLeft;
            var y = screen.pageY + scrollTop;
            var layerConfig = editor.renderer && editor.renderer.layerConfig;
            y -= Math.round(layerConfig && layerConfig.lineHeight ? layerConfig.lineHeight * 1.5 : 24);
            var rect = editor.container && editor.container.getBoundingClientRect && editor.container.getBoundingClientRect();
            if (rect && rect.right > rect.left && rect.bottom > rect.top) {
                var pageLeft = rect.left + scrollLeft;
                var pageRight = rect.right + scrollLeft;
                var pageTop = rect.top + scrollTop;
                var pageBottom = rect.bottom + scrollTop;
                if (x < pageLeft) x = pageLeft;
                if (x > pageRight) x = pageRight;
                if (y < pageTop) y = pageTop;
                if (y > pageBottom) y = pageBottom;
            }
            event.callAndroidEditor("showContextMenu", x, y);
            editor.off("input", hideContextMenu);
            editor.on("input", hideContextMenu);
            return;
        }
        if (opts && opts.longtap && pos && !editor.selection.isEmpty()) {
            return;
        }
        if (!editor.getOption("enableMobileMenu")) {
            if (contextMenu) {
                hideContextMenu();
            }
            return;
        }
        if (!contextMenu) createContextMenu();
        var cursor = editor.selection.cursor;
        var pagePos = editor.renderer.textToScreenCoordinates(cursor.row, cursor.column);
        var leftOffset = editor.renderer.textToScreenCoordinates(0, 0).pageX;
        var scrollLeft = editor.renderer.scrollLeft;
        var rect = editor.container.getBoundingClientRect();
        contextMenu.style.top = pagePos.pageY - rect.top - 3 + "px";
        if (pagePos.pageX - rect.left < rect.width - 70) {
            contextMenu.style.left = "";
            contextMenu.style.right = "10px";
        } else {
            contextMenu.style.right = "";
            contextMenu.style.left = leftOffset + scrollLeft - rect.left + "px";
        }
        contextMenu.style.display = "";
        contextMenu.firstChild.style.display = "none";
        editor.on("input", hideContextMenu);
    }
    function hideContextMenu(e) {
        event.callAndroidEditor("hideContextMenu");
        if (contextMenu)
            contextMenu.style.display = "none";
        editor.off("input", hideContextMenu);
    }

    function handleLongTap() {
        longTouchTimer = null;
        clearTimeout(longTouchTimer);
        var range = editor.selection.getRange();
        var inSelection = range.contains(pos.row, pos.column);
        if (range.isEmpty() || !inSelection) {
            editor.selection.moveToPosition(pos);
            editor.selection.selectWord();
        }
        mode = "wait";
        didLongTap = true;
        showContextMenu({longtap: true, clientX: startX, clientY: startY});
    }
    function switchToSelectionMode() {
        longTouchTimer = null;
        clearTimeout(longTouchTimer);
        editor.selection.moveToPosition(pos);
        var range = clickCount >= 2
            ? editor.selection.getLineRange(pos.row)
            : editor.session.getBracketRange(pos);
        if (range && !range.isEmpty()) {
            editor.selection.setRange(range);
        } else {
            editor.selection.selectWord();
        }
        mode = "wait";
    }
    event.addListener(el, "contextmenu", function(e) {
        if (!pressed) return;
        var textarea = editor.textInput.getElement();
        textarea.focus();
    }, editor);
    event.addListener(el, "touchstart", function (e) {
        var touches = e.touches;
        cancelAnimation();
        cancelPendingScroll();
        if (longTouchTimer || touches.length > 1) {
            endTouchScroll(0);
            clearTimeout(longTouchTimer);
            longTouchTimer = null;
            touchStartT = -1;
            mode = "zoom";
            return;
        }
        
        pressed = editor.$mouseHandler.isMousePressed = true;
        var h = editor.renderer.layerConfig.lineHeight;
        var w = editor.renderer.layerConfig.lineHeight;
        var t = getEventTime(e);
        lastT = t;
        var touchObj = touches[0];
        var x = touchObj.clientX;
        var y = touchObj.clientY;
        // reset clickCount if the new touch is far from the old one
        if (Math.abs(startX - x) + Math.abs(startY - y) > h)
            touchStartT = -1;
        
        startX = e.clientX = x;
        startY = e.clientY = y;
        initialX = x;
        initialY = y;
        vX = vY = 0;
        
        var ev = new MouseEvent(e, editor);
        pos = ev.getDocumentPosition();

        if (t - touchStartT < 500 && touches.length == 1 && !animationSteps) {
            clickCount++;
            e.preventDefault();
            e.button = 0;
            switchToSelectionMode();
        } else {
            clickCount = 0;
            var cursor = editor.selection.cursor;
            var anchor = editor.selection.isEmpty() ? cursor : editor.selection.anchor;
            
            var cursorPos = editor.renderer.$cursorLayer.getPixelPosition(cursor, true);
            var anchorPos = editor.renderer.$cursorLayer.getPixelPosition(anchor, true);
            var rect = editor.renderer.scroller.getBoundingClientRect();
            var offsetTop = editor.renderer.layerConfig.offset;
            var offsetLeft = editor.renderer.scrollLeft;
            var weightedDistance = function(x, y) {
                x = x / w;
                y = y / h - 0.75;
                return x * x + y * y;
            };
            
            if (e.clientX < rect.left) {
                mode = "zoom";
                return;
            }
            
            var diff1 = weightedDistance(
                e.clientX - rect.left - cursorPos.left + offsetLeft,
                e.clientY - rect.top - cursorPos.top + offsetTop
            );
            var diff2 = weightedDistance(
                e.clientX - rect.left - anchorPos.left + offsetLeft,
                e.clientY - rect.top - anchorPos.top + offsetTop
            );
            if (diff1 < 3.5 && diff2 < 3.5)
                mode = diff1 > diff2 ? "cursor" : "anchor";

            if (diff2 < 3.5)
                mode = "anchor";
            else if (diff1 < 3.5)
                mode = "cursor";
            else
                mode = "scroll";
            longTouchTimer = setTimeout(handleLongTap, 450);
        }
        touchStartT = t;
    }, editor);

    var lastPos;

    event.addListener(el, "touchend", function (e) {
        pressed = editor.$mouseHandler.isMousePressed = false;
        cancelAnimation();
        if (mode == "zoom") {
            endTouchScroll(0);
            mode = "";
            animationSteps = 0;
        } else if (longTouchTimer) {
            editor.selection.moveToPosition(pos);
            animationSteps = 0;
            if(lastPos != undefined && pos.row == lastPos.row && pos.column == lastPos.column) {
                showContextMenu();
            } else {
                // console.log("liuzh: touched-hideContextMenu-1, el="+el.id);
                hideContextMenu();
            }
            lastPos = pos;
        } else if (mode == "scroll") {
            flushPendingScroll();
            animate();
            // console.log("liuzh: touched-hideContextMenu-2, el="+el.id);
            hideContextMenu();
        } else if (didLongTap) {
        } else {
            showContextMenu();
        }
        didLongTap = false;
        clearTimeout(longTouchTimer);
        longTouchTimer = null;
    }, editor);
    event.addListener(el, "touchcancel", function () {
        pressed = editor.$mouseHandler.isMousePressed = false;
        cancelAnimation();
        cancelPendingScroll();
        endTouchScroll(0);
        didLongTap = false;
        clearTimeout(longTouchTimer);
        longTouchTimer = null;
        mode = "";
    }, editor);
    event.addListener(el, "touchmove", function (e) {
        if (longTouchTimer) {
            clearTimeout(longTouchTimer);
            longTouchTimer = null;
        }
        var touches = e.touches;
        if (touches.length > 1 || mode == "zoom") return;

        var touchObj = touches[0];

        var wheelX = startX - touchObj.clientX;
        var wheelY = startY - touchObj.clientY;
        var totalX = touchObj.clientX - initialX;
        var totalY = touchObj.clientY - initialY;
        var absTotalX = Math.abs(totalX);
        var absTotalY = Math.abs(totalY);
        var scrollSwitchDistance = Math.max(6, editor.renderer.layerConfig.lineHeight * 0.35);

        if (mode == "wait") {
            if (wheelX * wheelX + wheelY * wheelY > 4)
                mode = "cursor";
            else
                return e.preventDefault();
        }
        if ((mode == "cursor" || mode == "anchor") && editor.selection.isEmpty()) {
            if (absTotalY > scrollSwitchDistance && absTotalY > absTotalX * 1.1)
                mode = "scroll";
        }

        startX = touchObj.clientX;
        startY = touchObj.clientY;

        e.clientX = touchObj.clientX;
        e.clientY = touchObj.clientY;

        var t = getEventTime(e);
        var dt = t - lastT;
        lastT = t;
        if (mode == "scroll") {
            if (absTotalY > scrollSwitchDistance && absTotalY > absTotalX * 1.15)
                wheelX = 0;
            else if (absTotalX > scrollSwitchDistance && absTotalX > absTotalY * 1.15)
                wheelY = 0;
            else {
                if (10 * Math.abs(wheelX) < Math.abs(wheelY)) wheelX = 0;
                if (10 * Math.abs(wheelY) < Math.abs(wheelX)) wheelY = 0;
            }
            var touchScrollSpeed = 1;
            wheelX *= touchScrollSpeed;
            wheelY *= touchScrollSpeed;
            if (scheduleScrollByTouch(wheelX, wheelY)) {
                updateVelocity(wheelX, wheelY, dt);
                e.preventDefault();
            } else {
                vX = vY = 0;
            }
        }
        else {
            var ev = new MouseEvent(e, editor);
            var pos = ev.getDocumentPosition();
            if (mode == "cursor")
                editor.selection.moveCursorToPosition(pos);
            else if (mode == "anchor")
                editor.selection.setSelectionAnchor(pos.row, pos.column);
            editor.renderer.scrollCursorIntoView(pos);
            e.preventDefault();
        }
    }, editor);

    function animate() {
        var speed = Math.sqrt(vX * vX + vY * vY);
        if (speed < minFlingVelocity) {
            endTouchScroll();
            return;
        }
        beginTouchScroll();
        animationSteps = 1;
        animationElapsed = 0;
        animationLastT = 0;
        animationTimer = requestFrame(function step(t) {
            var dt = animationLastT ? t - animationLastT : 16;
            animationLastT = t;
            dt = Math.max(0, Math.min(dt || 16, 32));
            animationElapsed += dt;
            speed = Math.sqrt(vX * vX + vY * vY);
            if (speed < minFlingVelocity || animationElapsed > maxFlingDuration) {
                cancelAnimation();
                return;
            }
            var velocityScale = Math.exp(-flingFriction * dt);
            var distanceScale = (1 - velocityScale) / flingFriction;
            var oldScrollTop = editor.session.getScrollTop();
            var oldScrollLeft = editor.session.getScrollLeft();
            if (!scrollByTouch(vX * distanceScale, vY * distanceScale)
                || oldScrollTop == editor.session.getScrollTop() && oldScrollLeft == editor.session.getScrollLeft()) {
                cancelAnimation();
                return;
            }
            vX *= velocityScale;
            vY *= velocityScale;
            animationSteps = 1;
            animationTimer = requestFrame(step);
        });
    }
};
