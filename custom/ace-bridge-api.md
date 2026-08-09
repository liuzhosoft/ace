# Ace Bridge API（`custom/ace-bridge.js`）

本文档描述 `custom/ace-bridge.js`（`Bridge`）在 `custom/editor.html` 中对外提供的指令（command）与宿主回调（`AndroidEditor.*`）约定，便于在 Android WebView（或其它宿主）中调用与对接。

## 集成方式

`custom/editor.html` 中通过：

- `var bridge = new Bridge(editor);`
- `bridge.bindEditorEventToJava();`

宿主侧通过调用全局函数 `handleJava(id, editorCommand)` 来触发 bridge 命令：

```js
handleJava(123, { cmd: "setText", data: { text: "...", file: "a.js" } })
```

返回值规则：

- 当 `id === 0` 时，`handleJava` 直接 `return result`（同步返回给 JS 调用方）
- 当 `id !== 0` 时，`handleJava` 调用 `AndroidEditor.returnValue(id, result)`（异步回传给宿主），并返回 `null`
- 当命令返回 `undefined` 时，按 `null` 回传

## 命令协议

`bridge.execCommand(cmd, data)` 的分发逻辑是：如果 `bridge[cmd]` 存在，则调用 `bridge[cmd](data)`。

因此：

- `cmd` 必须是 `Bridge` 实例上存在的方法名字符串
- `data` 为该方法期望的对象参数（可为 `null/undefined`，具体看命令）
- 若 `cmd` 不存在，会触发 `alert('Unknown cmd: ' + cmd)`

## Bridge 命令列表

### 编辑/撤销栈

- `undo()`: 撤销
- `redo()`: 重做
- `canUndo() -> boolean`: 是否可撤销
- `canRedo() -> boolean`: 是否可重做
- `resetTextChange() -> true`: 将当前文本状态标记为“未改变”（通常用于保存后重置脏状态）

### 剪贴板/选择

- `onCopy()`: 复制所选文本并清除选择
- `onCut()`: 剪切所选文本并清除选择
- `onPaste({ text: string })`: 粘贴 `text` 并清除选择
- `duplication()`: 复制选择区域（duplicateSelection）并清除选择
- `selectAll()`: 全选
- `clearSelection()`: 清除选择
- `hasSelection() -> boolean`: 是否存在选择
- `getSelectedText() -> string`: 获取当前选择文本

### 文本内容

- `setText({ text: string, file?: string, line?: number, column?: number })`
  - `file` 用于根据路径推断语法高亮模式（`modelist.getModeForPath`）
  - 会 `setMode({ mode })`，再 `editor.setValue(text, -1)`，并清空选择
  - 若 `line > 0 || column > 0` 则调用 `editor.gotoLine(line, column, true)`
  - 会重置撤销栈（`editor.session.getUndoManager().reset()`）
- `getText() -> string`: 获取全文
- `insertOrReplaceText({ text: string, requireSelected?: boolean })`
  - 只读时无效
  - `requireSelected === true` 且无选择时不插入
  - 通过 `editor.insert(text)` 插入（不会真正“replace”，替换取决于 Ace 对插入时选择区域的行为）

### 光标/定位

- `gotoTop()`: 跳到文件开头
- `gotoEnd()`: 跳到文件结尾
- `gotoLine({ line: number, column: number })`: 跳到指定位置（参数直接传入 `editor.gotoLine(line, column, true)`）
- `getCurrentPosition() -> [number, number]`: 返回 `[row, column]`（Ace 的 `selectionLead`，从 0 开始）
- `getLineText({ line: number, limitLength: number }) -> string`
  - `line` 是 Ace 的行号 `row`（从 0 开始），用于 `editor.session.getLine(line)`
  - 返回值会被截断到 `limitLength`

### 查找/替换

- `doFind({ findText: string, replaceText?: string, caseSensitive?: boolean, wholeWordOnly?: boolean, regex?: boolean, startIndex?: number, focusEditor?: boolean }) -> string`
  - 有 `replaceText` 时执行全部替换，否则重新计算所有匹配项
  - 返回 JSON 字符串 `{"current": number, "total": number, "errorCode"?: string}`
  - 正则表达式无效时返回 `errorCode: "invalid_regular_expression"`，不会按其他字面量继续搜索或替换
  - 重新计算时保留当前匹配位置；匹配范围变化时优先选择覆盖原位置的结果
  - `focusEditor === false` 时保留宿主输入框焦点
- `moveSearchResult({ forward?: boolean, focusEditor?: boolean }) -> string`
  - `forward === false` 移动到上一个结果，否则移动到下一个结果
  - 首尾之间循环，并返回当前匹配序号和总数
- `replaceSearchResult({ findText: string, replaceText?: string, caseSensitive?: boolean, wholeWordOnly?: boolean, regex?: boolean, focusEditor?: boolean }) -> string`
  - 仅替换当前激活结果，正则模式下支持捕获组替换
  - 正则模式使用完整文档上下文计算替换内容，支持依赖前后文和零宽匹配的表达式
  - 替换后光标移动到替换内容末尾，宿主可继续调用 `doFind` 重新计算结果
- `clearSearchResult() -> string`
  - 清除搜索 Marker、当前搜索状态和选区
  - 文档内容变化时 bridge 也会自动清除缓存结果，避免旧 Range 被继续操作

### 只读/显示/选项

- `readOnly({ value: boolean })`: 设置只读
- `setFontSize({ value: number|string })`: 设置字号（传给 `editor.setFontSize`）
- `setShowLineNumber({ value: boolean })`: 显示/隐藏行号（gutter）
- `setShowInvisible({ value: boolean })`: 显示/隐藏不可见字符
- `setWordWrap({ value: boolean })`: 自动换行开关
- `setTabSize({ value: number })`: Tab 宽度
- `setAutoIndent({ value: boolean })`: 自动缩进开关（`enableAutoIndent`）
- `setSpaceAsTab({ value: boolean })`: 使用软 Tab
- `setZoomable({ value: boolean })`: 缩放开关（依赖 Ace 的 `setZoomable` 扩展能力）

### 语法高亮/主题

- `setMode({ mode: string })`
  - 例：`{ mode: "ace/mode/javascript" }`
  - 会调用 `AndroidEditor.onModeChanged(modeName)` 回传可读模式名（caption）
- `enableHighlight({ value: boolean })`
  - `true`：恢复到 `this.mode`
  - `false`：`editor.session.setMode(null)`（关闭高亮）
- `setTheme({ value: string })`
  - 例：`{ value: "ace/theme/monokai" }`
  - 设置后约 380ms 会尝试移除 id 为 `theme` 的 `<style>` 节点

### 换行符

- `convertWrapCharTo({ value: "\r\n" | "\n" | string })`
  - `"\r\n"` => `windows`
  - `"\n"` => `unix`
  - 其它 => `auto`

### Insets（安全区/边距）

- `setInsets({ top?: number, right?: number, bottom?: number, left?: number }) -> true`
  - 入参会被规整为非负整数，非数字按 0 处理
  - `right` 会用于 `editor.renderer.setMargin(0, 0, 0, right)`（若存在该方法）
  - `bottom` 会写入 `editor.renderer.$extraHeight`
  - 会触发 `editor.resize(true)` 并异步应用一组样式到 gutter/scroller/scrollbars
  - `bottom` 会叠加水平滚动条高度用于计算 scroller 的 bottom

### 搜索结果视图（特殊）

- `setSearchResult({ find: string, data: Array<any>, text: string, file?: string, line?: number, column?: number })`
  - 会将 `data.file` 强制设为 `"file.searchresult"`，并写入 `window.findText / window.findData`
  - 会注册 `selection.on('changeCursor', ...)`：当光标所在 token 的 `type === 'keyword'` 时，调用 `AndroidEditor.openFile(file, line, column)`
  - 会设置只读 `editor.setReadOnly(true)`，再调用 `setText(data)`

### 未实现（占位）

- `forwardLocation()`: 当前为占位（todo）
- `backLocation()`: 当前为占位（todo）

## 宿主侧需要提供的 `AndroidEditor` 回调

`ace-bridge.js` 与 `editor.html` 会主动调用下列方法；宿主侧需注入同名对象与函数：

- `AndroidEditor.returnValue(id: number, value: any)`：用于 `handleJava(id!=0)` 的回传
- `AndroidEditor.onModeChanged(modeName: string)`：`setMode` 后回调
- `AndroidEditor.onTextChanged(changed: boolean)`：普通编辑内容变化回调（基于 session 行数与 undo 状态推断）
- `AndroidEditor.onSearchReplaceTextChanged?(changed: boolean)`：可选的搜索替换内容变化回调；一次替换命令仅通知一次，未实现时回退到 `onTextChanged`
- `AndroidEditor.updateCursorBeforeText(text: string)`：光标前最多 30 列的文本片段
- `AndroidEditor.onScrollStart()` / `AndroidEditor.onScrollEnd()`：滚动开始/结束
- `AndroidEditor.onCursorStatusChanged(text: string)`：状态栏文本（形如 `"row:col"`，有选择则追加 `"(len)"`）
- `AndroidEditor.onSelectionChange(selected: boolean, text: string)`：选择变化回调
- `AndroidEditor.showActionMode()` / `AndroidEditor.hideActionMode()`：长按/选择时的操作面板显示隐藏（有 100ms 防抖）
- `AndroidEditor.openFile(file: string, line: number, column: number)`：`setSearchResult` 中点击结果时打开文件

## 关键行为说明

- `line`/`row` 的基准不统一：`gotoLine`/`setText` 使用 Ace 的 `gotoLine(lineNumber, ...)`（通常是从 1 开始），但 `getLineText` 与 `getCurrentPosition` 返回/使用的是 `row`（从 0 开始）。宿主侧建议保持“显示用 1-based，内部 row 用 0-based”的约定，并在调用不同命令时按各自要求转换。
- `setSearchResult` 会注册一次 `changeCursor` 监听；如果多次调用该命令，可能叠加多个监听器（当前实现未做去重/解绑）。
