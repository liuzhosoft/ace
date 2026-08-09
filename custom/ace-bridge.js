var lang = require("ace/lib/lang");
var modelist = require("ace/ext/modelist");

function Bridge(editor) {
    this.mode = null;
    this.lastTextLength = 0;
    this.editor = editor;
    this.loading = false;
    this.insets = {top: 0, right: 0, bottom: 0, left: 0};
    this._searchReplacementActive = false;
    this._searchReplacementChanged = false;

    this._notifyTextChanged = function(fromSearchReplacement) {
        var len = this.editor.session.getLength();
        var changed = len !== this.lastTextLength || (len === this.lastTextLength && this.canUndo());
        var searchReplacementCallback = AndroidEditor.onSearchReplaceTextChanged;
        if (fromSearchReplacement && typeof searchReplacementCallback === "function") {
            searchReplacementCallback.call(AndroidEditor, changed);
        } else {
            AndroidEditor.onTextChanged(changed);
        }
        this.lastTextLength = len;
    };

    this._runSearchReplacement = function(operation) {
        this._searchReplacementActive = true;
        this._searchReplacementChanged = false;
        try {
            return operation();
        } finally {
            this._searchReplacementActive = false;
            if (this._searchReplacementChanged) {
                this._searchReplacementChanged = false;
                this._notifyTextChanged(true);
            }
        }
    };

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

    this.replaceSearchResult = function (data) {
        data = data || {};
        return this._searchAction({
            action: "replaceCurrent",
            findText: data.findText,
            replaceText: data.replaceText,
            caseSensitive: data.caseSensitive,
            wholeWordOnly: data.wholeWordOnly,
            regex: data.regex,
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

        function invalidRegularExpressionSummary() {
            return JSON.stringify({
                current: 0,
                total: 0,
                errorCode: "invalid_regular_expression"
            });
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

        function createSearch(options) {
            var Search = require("ace/search").Search;
            var search = new Search();
            search.set(options);
            // 复用 Ace 自身的编译逻辑，兼容其 Unicode 回退和多行正则规则。
            if (options.regExp && !search.$assembleRegExp(search.getOptions())) {
                return null;
            }
            return search;
        }

        function hasSameSearchOptions(left, right) {
            return left && right &&
                left.needle === right.needle &&
                left.caseSensitive === right.caseSensitive &&
                left.regExp === right.regExp &&
                left.wholeWord === right.wholeWord;
        }

        function replacementForRange(search, range, replacement) {
            var options = search.getOptions();
            // 非正则替换内容不依赖匹配上下文，无需复制并重建整篇文档。
            if (!options.regExp) return replacement;

            var re = search.$assembleRegExp(options);
            if (!re) {
                throw new Error("Search regular expression is unavailable");
            }
            // Ace 会把包含真实换行的表达式拆成逐行正则；保持其原有替换行为。
            if (Array.isArray(re)) return replacement;

            // Search 跨行匹配统一使用 LF，位置索引也必须基于相同的逻辑文本计算。
            var lines = session.getDocument().getAllLines();
            var input = lines.join("\n");
            function positionToIndex(position) {
                var index = position.column;
                for (var row = 0; row < position.row; row++) {
                    index += lines[row].length + 1;
                }
                return index;
            }
            var start = positionToIndex(range.start);
            var end = positionToIndex(range.end);
            var flags = re.flags.replace(/[gy]/g, "") + "y";
            var targetRe = new RegExp(re.source, flags);
            targetRe.lastIndex = start;
            var match = targetRe.exec(input);
            if (!match || match.index !== start || match[0].length !== end - start) return null;

            var template = search.parseReplaceString(replacement);
            targetRe.lastIndex = start;
            var output = input.replace(targetRe, template);
            var insertedLength = output.length - input.length + end - start;
            return output.slice(start, start + insertedLength);
        }

        function findStartIndex(ranges, origin) {
            if (typeof data.startIndex === "number" && isFinite(data.startIndex)) {
                var index = data.startIndex | 0;
                if (index < 0) return 0;
                if (index >= ranges.length) return ranges.length - 1;
                return index;
            }
            var cursor = origin || editor.getCursorPosition();
            for (var i = 0; i < ranges.length; i++) {
                var range = ranges[i];
                var startsBeforeOrAt = range.start.row < cursor.row ||
                    (range.start.row === cursor.row && range.start.column <= cursor.column);
                var endsAfter = range.end.row > cursor.row ||
                    (range.end.row === cursor.row && range.end.column > cursor.column);
                // 选项变化可能让同一处匹配向左扩展，优先保留覆盖原锚点的结果。
                if (startsBeforeOrAt && endsAfter) return i;
            }
            for (var j = 0; j < ranges.length; j++) {
                var start = ranges[j].start;
                if (start.row > cursor.row || (start.row === cursor.row && start.column >= cursor.column)) {
                    return j;
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
            state.searchOrigin = {row: range.start.row, column: range.start.column};
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
            var replaceOptions = searchOptions();
            if (!replaceOptions.needle) {
                clearSearch();
                return emptySummary();
            }
            if (!createSearch(replaceOptions)) {
                clearSearch();
                return invalidRegularExpressionSummary();
            }
            clearSearch();
            bridge._runSearchReplacement(function() {
                editor.replaceAll(data.replaceText || "", replaceOptions);
            });
            return emptySummary();
        }

        if (data.action === "replaceCurrent") {
            var currentOptions = searchOptions();
            if (!currentOptions.needle) return summary();
            var currentSearch = createSearch(currentOptions);
            if (!currentSearch) {
                clearSearch();
                return invalidRegularExpressionSummary();
            }
            state = window.bdSearchState;
            if (!state || state.session !== session || !state.ranges || !state.ranges.length ||
                state.index < 0 || state.index >= state.ranges.length) {
                return summary();
            }
            if (!hasSameSearchOptions(state.options, currentOptions)) {
                throw new Error("Search options do not match the active result");
            }
            var currentRange = state.ranges[state.index];
            var replaceText = data.replaceText == null ? "" : String(data.replaceText);
            var replacement = replacementForRange(currentSearch, currentRange, replaceText);
            if (replacement == null) return summary();
            // 搜索范围会随文档变更失效，替换前复制位置并清理全部 Marker。
            var targetRange = {
                start: {row: currentRange.start.row, column: currentRange.start.column},
                end: {row: currentRange.end.row, column: currentRange.end.column}
            };
            clearSearch();
            var replacementEnd = bridge._runSearchReplacement(function() {
                return session.replace(targetRange, replacement);
            });
            editor.moveCursorToPosition(replacementEnd);
            editor.renderer.scrollCursorIntoView(null, 0.5);
            if (data.focusEditor !== false) {
                editor.focus();
            }
            return emptySummary();
        }

        if (data.action === "find") {
            var searchOrigin = editor.getCursorPosition();
            if (state && state.session === session && state.ranges && state.ranges.length &&
                state.index >= 0 && state.index < state.ranges.length) {
                var activeStart = state.ranges[state.index].start;
                // 普通刷新从当前匹配项起点重新定位，避免清除选区后以末尾光标跳到下一项。
                searchOrigin = {row: activeStart.row, column: activeStart.column};
            } else if (state && state.session === session && state.searchOrigin) {
                // 无结果或正则解析失败时继续保留上一次锚点，恢复搜索后仍从原位置定位。
                searchOrigin = {row: state.searchOrigin.row, column: state.searchOrigin.column};
            }
            clearSearch();
            var options = searchOptions();
            if (!options.needle) return emptySummary();
            state = {
                session: session,
                ranges: [],
                index: 0,
                markers: [],
                activeMarker: null,
                options: options,
                searchOrigin: {row: searchOrigin.row, column: searchOrigin.column}
            };
            window.bdSearchState = state;
            // 在校验前写入状态，正则表达式解析失败时也不会丢失定位锚点。
            var search = createSearch(options);
            if (!search) return invalidRegularExpressionSummary();
            ensureCss();
            var ranges = search.findAll(session);
            state.ranges = ranges;
            for (var i = 0, markerCount = Math.min(ranges.length, markerLimit); i < markerCount; i++) {
                state.markers.push(session.addMarker(ranges[i], "ace_search_result", "text", false));
            }
            if (ranges.length > 0) {
                activate(findStartIndex(ranges, searchOrigin));
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
            // 文档变化后普通 Range 不再可靠，任何后续操作都必须先重新搜索。
            self._clearSearchState(false);
            if (self.loading)
                return;
            if (self._searchReplacementActive) {
                self._searchReplacementChanged = true;
                return;
            }
            self._notifyTextChanged(false);

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
