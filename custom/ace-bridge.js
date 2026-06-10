var lang = require("ace/lib/lang");
var modelist = require("ace/ext/modelist");

function Bridge(editor) {
    this.mode = null;
    this.lastTextLength = 0;
    this.editor = editor;
    this.loading = false;
    this.insets = {top: 0, right: 0, bottom: 0, left: 0};

    this._getInsetNumber = function(data, key) {
        if (!data) return 0;
        var n = data[key];
        if (typeof n !== "number" || !isFinite(n)) return 0;
        n = n | 0;
        return n < 0 ? 0 : n;
    };

    this.setInsets = function(data) {
        var left = this._getInsetNumber(data, "left");
        var right = this._getInsetNumber(data, "right");
        var bottom = this._getInsetNumber(data, "bottom");
        var top = this._getInsetNumber(data, "top");

        this.insets = {top: top, right: right, bottom: bottom, left: left};

        if (editor && editor.renderer) {
            editor.renderer.$insets = this.insets;
        }

        if (editor && editor.resize) {
            editor.resize(true);
        }

        return true;
    };

    this.execCommand = function (cmd, data) {
        if (this[cmd]) {
            return this[cmd](data);
        } else {
            alert('Unknown cmd: ' + cmd);
        }
    };

    this.redo = function () {
        editor.redo();
    };

    this.undo = function () {
        editor.undo();
    };

    this.canUndo = function () {
        return editor.session.getUndoManager().hasUndo();
    };

    this.canRedo = function () {
        return editor.session.getUndoManager().hasRedo();
    };

    this.onCopy = function () {
        editor.onCopy();
        editor.clearSelection();
    };

    this.onPaste = function (data) {
        editor.onPaste(data['text']);
        editor.clearSelection();
    };

    this.onCut = function () {
        editor.onCut();
        editor.clearSelection();
    };

    this.duplication = function () {
        editor.duplicateSelection();
        editor.clearSelection();
    };

    this.convertWrapCharTo = function (data) {
        // editor.replaceAll(data['value'], {'needle':"\r\n|\n|\r", 'regExp':true});
        var mode = "auto";
        if (data['value'] === "\r\n") {
            mode = "windows";
        } else if (data['value'] === "\n") {
            mode = "unix";
        }
        editor.getSession().getDocument().setNewLineMode(mode);
    };

    this.gotoTop = function () {
        editor.gotoLine(1, 0)
        editor.navigateFileStart();
    };

    this.gotoEnd = function () {
        var row = editor.session.getLength() - 1;
        editor.gotoLine(row + 1, 0)
        editor.navigateFileEnd();
    };

    this.gotoLine = function (data) {
        editor.gotoLine(data['line'], data['column'], true);
    };

    this.readOnly = function (data) {
        editor.setReadOnly(data['value']);
    };

    this.selectAll = function () {
        editor.selectAll();
    };

    this.forwardLocation = function () {
        // todo
    };

    this.backLocation = function () {
        // todo
    };

    this.insertOrReplaceText = function (data) {
        if (editor.getReadOnly()) return;
        var requireSelected = data['requireSelected'];
        var text = data['text'];
        if (requireSelected && !this.hasSelection()) {
            return;
        }
        editor.insert(text);
    };

    this.hasSelection = function () {
        return !editor.selection.isEmpty();
    };

    this.setSearchResult = function (data) {
        var event = require("ace/lib/event");

        data['file'] = "file.searchresult";
        window.findText = data['find'];
        window.findData = data['data'];

        editor.selection.on('changeCursor', function (e, selection) {
            if (!window.findData) return;
            var lead = selection.getSelectionLead();
            var token = selection.session.getTokenAt(lead.row, lead.column);
            if (!token || token.type !== 'keyword') return;
            var doc = selection.session.getDocument();
            if (lead.row >= window.findData.length) return;
            var data = window.findData[lead.row];
            AndroidEditor.openFile(data['file'], data['line'], data['column']);
        });
        editor.setReadOnly(true);
        this.setText(data);
    };

    this._clearSearchState = function (clearSelection) {
        var state = window.bdSearchState || null;
        if (!state) return;
        var markerSession = state.session || editor.session;
        if (state.markers) {
            for (var i = 0; i < state.markers.length; i++) {
                markerSession.removeMarker(state.markers[i]);
            }
        }
        if (state.activeMarker) {
            markerSession.removeMarker(state.activeMarker);
        }
        window.bdSearchState = null;
        if (editor.exitMultiSelectMode) {
            editor.exitMultiSelectMode();
        }
        if (clearSelection !== false) {
            editor.clearSelection();
        }
    };

    this.setText = function (data) {

        this.loading = true;
        this._clearSearchState(false);

        var text = data['text'];
        var file = data['file'];
        var modeCls = modelist.getModeForPath(file ? file : '');
        console.log("setText: mode="+modeCls.mode);
        this.setMode({ 'mode': modeCls.mode });
        editor.setValue(text, -1);
        editor.clearSelection();
        var line = data['line'] || 0;
        var column = data['column'] || 0;
        if (line > 0 || column > 0) {
            editor.gotoLine(line, column, true);
        }

        this.resetTextChange();

        editor.session.getUndoManager().reset();

        this.loading = false;
    };

    this.getText = function () {
        return editor.getValue();
    };

    this.getSelectedText = function () {
        var range = editor.getSelection().getRange();
        return editor.session.getTextRange(range);
    };

    this.getLineText = function (data) {
        var line = data['line'];
        var limitLength = data['limitLength'];
        var text = editor.session.getLine(line);
        return text.substring(0, Math.min(limitLength, text.length));
    };

    this.enableHighlight = function (data) {
        var value = data['value'];
        if (value) {
            editor.session.setMode(this.mode);
        } else {
            editor.session.setMode(null);
        }
    };

    this.setMode = function (data) {
        var modelist = require("ace/ext/modelist");
        this.mode = data['mode'];
        editor.session.setMode(this.mode);
        var modeName = "Text";
        var m;
        for (var i in modelist.modes) {
            m = modelist.modes[i];
            if (this.mode == m.mode) {
                modeName = m.caption;
                break;
            }
        }
        AndroidEditor.onModeChanged(modeName);
    };

    /**
     * 保存文件后，设置文本为非改变状态
     */
    this.resetTextChange = function () {
        this.lastTextLength = editor.session.getLength();
        return true;
    };


    this.doFind = function (data) {
        data = data || {};
        var action = data.replaceText == null ? "find" : "replace";
        return this._searchAction({
            action: action,
            findText: data.findText,
            replaceText: data.replaceText,
            caseSensitive: data.caseSensitive,
            wholeWordOnly: data.wholeWordOnly,
            regex: data.regex,
            startIndex: data.startIndex,
            focusEditor: data.focusEditor
        });
    };

    this.moveSearchResult = function (data) {
        data = data || {};
        return this._searchAction({
            action: "move",
            forward: data.forward,
            focusEditor: data.focusEditor
        });
    };

    this.clearSearchResult = function () {
        return this._searchAction({action: "clear"});
    };

    this._searchAction = function (data) {
        var session = editor.session;
        var bridge = this;
        var state = window.bdSearchState || null;
        var markerLimit = typeof data.maxMarkers === "number" && isFinite(data.maxMarkers)
            ? Math.max(0, data.maxMarkers | 0)
            : 1000;

        function emptySummary() {
            return JSON.stringify({current: 0, total: 0});
        }

        function summary() {
            var s = window.bdSearchState;
            var total = s && s.ranges ? s.ranges.length : 0;
            var current = total > 0 ? s.index + 1 : 0;
            return JSON.stringify({current: current, total: total});
        }

        function ensureCss() {
            var dom = require("ace/lib/dom");
            dom.importCssString(
                ".ace_marker-layer .ace_search_result {" +
                "position:absolute;z-index:4;box-sizing:border-box;" +
                "background:rgba(255,213,79,.38);border-radius:2px;" +
                "}" +
                ".ace_marker-layer .ace_search_active {" +
                "position:absolute;z-index:7;box-sizing:border-box;" +
                "background:rgba(255,171,64,.7);border-radius:2px;" +
                "}" +
                ".ace_dark .ace_marker-layer .ace_search_result {" +
                "background:rgba(255,213,79,.34);" +
                "}" +
                ".ace_dark .ace_marker-layer .ace_search_active {" +
                "background:rgba(255,193,7,.82);" +
                "}",
                "bd_search_result_css",
                false
            );
        }

        function clearSearch() {
            bridge._clearSearchState();
            state = null;
        }

        function searchOptions() {
            return {
                needle: data.findText || "",
                caseSensitive: !!data.caseSensitive,
                regExp: !!data.regex,
                wholeWord: !!data.wholeWordOnly,
                wrap: true
            };
        }

        function findStartIndex(ranges) {
            if (typeof data.startIndex === "number" && isFinite(data.startIndex)) {
                var index = data.startIndex | 0;
                if (index < 0) return 0;
                if (index >= ranges.length) return ranges.length - 1;
                return index;
            }
            var cursor = editor.getCursorPosition();
            for (var i = 0; i < ranges.length; i++) {
                var start = ranges[i].start;
                if (start.row > cursor.row || (start.row === cursor.row && start.column >= cursor.column)) {
                    return i;
                }
            }
            return 0;
        }

        function activate(index) {
            state = window.bdSearchState;
            if (!state || !state.ranges || !state.ranges.length) return;
            if (state.activeMarker) {
                session.removeMarker(state.activeMarker);
            }
            state.index = index;
            var range = state.ranges[index];
            editor.selection.setSelectionRange(range, false);
            state.activeMarker = session.addMarker(range, "ace_search_active", "text", false);
            editor.renderer.scrollCursorIntoView(null, 0.5);
            if (data.focusEditor !== false) {
                editor.focus();
            }
        }

        if (data.action === "clear") {
            clearSearch();
            return emptySummary();
        }

        if (data.action === "replace") {
            clearSearch();
            var replaceOptions = searchOptions();
            if (!replaceOptions.needle) return emptySummary();
            editor.replaceAll(data.replaceText || "", replaceOptions);
            return emptySummary();
        }

        if (data.action === "find") {
            clearSearch();
            var options = searchOptions();
            if (!options.needle) return emptySummary();
            ensureCss();
            var Search = require("ace/search").Search;
            var search = new Search();
            search.set(options);
            var ranges = search.findAll(session);
            state = {
                session: session,
                ranges: ranges,
                index: 0,
                markers: [],
                activeMarker: null
            };
            window.bdSearchState = state;
            for (var i = 0, markerCount = Math.min(ranges.length, markerLimit); i < markerCount; i++) {
                state.markers.push(session.addMarker(ranges[i], "ace_search_result", "text", false));
            }
            if (ranges.length > 0) {
                activate(findStartIndex(ranges));
            } else {
                editor.clearSelection();
            }
            return summary();
        }

        if (data.action === "move") {
            state = window.bdSearchState;
            if (!state || !state.ranges || !state.ranges.length) return summary();
            var step = data.forward === false ? -1 : 1;
            activate((state.index + step + state.ranges.length) % state.ranges.length);
            return summary();
        }

        return summary();
    };

    this.setFontSize = function (data) {
        editor.setFontSize(data['value']);
    };

    this.setShowLineNumber = function (data) {
        editor.renderer.setShowGutter(data['value']);
    };

    this.setShowInvisible = function (data) {
        editor.setShowInvisibles(data['value']);
    };

    this.setWordWrap = function (data) {
        editor.session.setUseWrapMode(data['value'] ? true : false);
    };

    this.setTabSize = function (data) {
        editor.session.setTabSize(data['value']);
    };

    this.setAutoIndent = function (data) {
        editor.setOption("enableAutoIndent", data['value']);
    };

    this.setSpaceAsTab = function (data) {
        editor.session.setUseSoftTabs(data['value']);
    };

    this.setZoomable = function (data) {
        editor.setZoomable(data['value']);
    };

    this.setTheme = function (data) {
        editor.setTheme(data['value']);
        setTimeout(function () {
            var style = document.getElementById('theme');
            if (style) {
                style.parentNode.removeChild(style);
            }
        }, 380);
    };

    this.getCurrentPosition = function () {
        var lead = editor.selection.getSelectionLead();
        return [lead.row, lead.column];
    };

    this.clearSelection = function () {
        editor.clearSelection();
    };
}

(function () {
    this.bindEditorEventToJava = function () {
        var self = this;
        this.editor.on("change", function (data) {
            if (self.loading)
                return;
            var len = self.editor.session.getLength();
            AndroidEditor.onTextChanged(len != self.lastTextLength || (len == self.lastTextLength && self.canUndo()));
            self.lastTextLength = len;

        });

        self.selected = false;
        var Range = require("ace/range").Range;
        this.editor.getSelection().on("changeCursor", function () {
            try {
                var cursor = self.editor.getSelection().getCursor();
                var range = new Range(cursor.row, Math.max(0, cursor.column - 30), cursor.row, cursor.column);
                var text = self.editor.session.getTextRange(range);
                AndroidEditor.updateCursorBeforeText(text);
            } catch (e) { }

        });
        this.editor.on("onLongTouch", function () {
            self.showActionMode();
        });
        this.editor.on("onClick", function () {
            if (self.hasSelection())
                return;
            self.hideActionMode();
        });
        this.editor.renderer.scrollBar.on("startScroll", function () {
            AndroidEditor.onScrollStart();
        });
        this.editor.renderer.scrollBar.on("endScroll", function () {
            AndroidEditor.onScrollEnd();
        });


        var updateStatus = function () {

            var sel = editor.selection;
            var c = sel.lead;

            var textContent = (c.row + 1) + ":" + (c.column + 1);

            if (!sel.isEmpty()) {
                textContent += " (" + editor.getSelectedText().length + ")";
            }
            AndroidEditor.onCursorStatusChanged(textContent);
        }

        var statusUpdate = lang.delayedCall(updateStatus.bind(this)).schedule.bind(null, 100);

        this.editor.on("changeStatus", statusUpdate);
        this.editor.on("changeSelection", function () {
            statusUpdate();

            if (self.loading) return;

            var s = self.getSelectedText();
            var selected = !!s;
            AndroidEditor.onSelectionChange(selected, s ? s : '');
            if (selected === self.selected) return;
            self.selected = selected;

            if (s) {
                self.showActionMode();
            } else {
                self.hideActionMode();
            }
        });
    };

    this.actionModeTimer = undefined;
    this.showActionMode = function () {
        if (this.actionModeTimer) {
            clearTimeout(this.actionModeTimer);
        }
        this.actionModeTimer = setTimeout(function () {
            AndroidEditor.showActionMode();
        }, 100);
    };

    this.hideActionMode = function () {
        if (this.actionModeTimer) {
            clearTimeout(this.actionModeTimer);
        }
        this.actionModeTimer = setTimeout(function () {
            AndroidEditor.hideActionMode();
        }, 100);
    };
}).call(Bridge.prototype);
