(async () => {
  let tree;
  let codeInput;
  let queryInput;

  const CAPTURE_REGEX = /@\s*([\w\._-]+)/g;
  const COLORS_BY_INDEX = [
    "gray",
    "blueviolet",
    "darkblue",
    "darkcyan",
    "mediumpurple",
    "darkred",
    "royalblue",
    "green",
    "cyan",
    "indigo",
    "navy",
    "red",
    "sienna",
    "magenta",
    "cornflowerblue",
    "blue",
    "orange",
    "tomato",
  ];
  const CodeMirrorLanguageModes = Object.seal({
    java: "text/x-java",
    kotlin: "text/x-kotlin",
    swift: "text/x-swift",
    csharp: "text/x-csharp",
    cpp: "text/x-c++src",
    c: "text/x-csrc",
    objectivec: "text/x-objectivec",
  });

  const codeContainer = document.getElementById("code-container");
  const loggingCheckbox = document.getElementById("logging-checkbox");
  const outputContainer = document.getElementById("output-container");
  const outputContainerScroll = document.getElementById(
    "output-container-scroll"
  );
  const playgroundContainer = document.getElementById("playground-container");
  const queryCheckbox = document.getElementById("query-checkbox");
  const queryContainer = document.getElementById("query-container");
  const updateTimeSpan = document.getElementById("update-time");
  const languageSelect = document.getElementById("language-select");

  const languagesByName = {};

  CodeMirror.keyMap.default[
    (CodeMirror.keyMap.default == CodeMirror.keyMap.macDefault
      ? "Cmd"
      : "Ctrl") + "-Space"
  ] = "autocomplete";

  loadState();

  await TreeSitter.init();

  const parser = new TreeSitter();

  CodeMirror.keyMap.default[
    (CodeMirror.keyMap.default == CodeMirror.keyMap.macDefault
      ? "Cmd"
      : "Ctrl") + "-Space"
  ] = "autocomplete";

  const codeEditor = CodeMirror(codeContainer, {
    value: codeInput,
    lineNumbers: true,
    showCursorWhenSelecting: true,
  });

  const queryEditor = CodeMirror(queryContainer, {
    value: queryInput,
    lineNumbers: true,
    showCursorWhenSelecting: true,
  });

  const cluster = new Clusterize({
    rows: [],
    noDataText: null,
    contentElem: outputContainer,
    scrollElem: outputContainerScroll,
  });

  const renderTreeOnCodeChange = debounce(renderTree, 50);
  const runTreeQueryOnChange = debounce(runTreeQuery, 50);

  let treeRows = null;
  let treeRowHighlightedIndex = -1;
  let parseCount = 0;
  let isRendering = 0;
  let query;

  codeEditor.on("changes", handleCodeChange);
  codeEditor.on("viewportChange", runTreeQueryOnChange);
  codeEditor.on("cursorActivity", debounce(handleCursorMovement, 150));
  queryEditor.on("changes", debounce(handleQueryChange, 150));
  languageSelect.addEventListener("change", handleLanguageChange);
  loggingCheckbox.addEventListener("change", handleLoggingChange);
  queryCheckbox.addEventListener("change", handleQueryEnableChange);
  outputContainer.addEventListener("click", handleTreeClick);

  const saveStateOnChange = debounce(saveState, 150);

  handleQueryEnableChange();
  await handleLanguageChange();

  playgroundContainer.style.visibility = "visible";

  async function handleLanguageChange() {
    const newLanguageName = languageSelect.value;

    if (!languagesByName[newLanguageName]) {
      languageSelect.disabled = true;
      try {
        languagesByName[newLanguageName] = await TreeSitter.Language.load(
          `./tree-sitter-${newLanguageName}.wasm?v=` + Math.random()
        );
      } catch (e) {
        return;
      } finally {
        languageSelect.disabled = false;
      }
    }

    tree = null;
    parser.setLanguage(languagesByName[newLanguageName]);

    await handleCodeChange();
    handleQueryChange();
  }

  await handleCodeChange();
  handleQueryChange();

  async function handleCodeChange(_editor, changes) {
    codeEditor.setOption("mode", CodeMirrorLanguageModes[languageSelect.value]);

    const newText = codeEditor.getValue() + "\n";
    const edits = tree && changes && changes.map(treeEditForEditorChange);

    const start = performance.now();
    if (edits) {
      for (const edit of edits) {
        tree.edit(edit);
      }
    }
    const newTree = parser.parse(newText, tree);
    const duration = (performance.now() - start).toFixed(1);

    updateTimeSpan.innerText = `${duration} ms`;
    if (tree) tree.delete();
    tree = newTree;
    parseCount++;

    await renderTreeOnCodeChange();
    runTreeQueryOnChange();
    saveStateOnChange();
  }

  async function renderTree() {
    isRendering++;
    const cursor = tree.walk();

    let currentRenderCount = parseCount;
    let row = "";
    let rows = [];
    let finishedRow = false;
    let visitedChildren = false;
    let indentLevel = 0;

    for (let i = 0; ; i++) {
      if (i > 0 && i % 10000 === 0) {
        await new Promise((r) => setTimeout(r, 0));
        if (parseCount !== currentRenderCount) {
          cursor.delete();
          isRendering--;
          return;
        }
      }

      let displayName;
      if (cursor.nodeIsMissing) {
        displayName = `MISSING ${cursor.nodeType}`;
      } else if (cursor.nodeIsNamed) {
        displayName = cursor.nodeType;
      }

      if (visitedChildren) {
        if (displayName) {
          finishedRow = true;
        }

        if (cursor.gotoNextSibling()) {
          visitedChildren = false;
        } else if (cursor.gotoParent()) {
          visitedChildren = true;
          indentLevel--;
        } else {
          break;
        }
      } else {
        if (displayName) {
          if (finishedRow) {
            row += "</div>";
            rows.push(row);
            finishedRow = false;
          }

          const startIndex = cursor.endIndex - cursor.nodeText.length;
          const endIndex = cursor.endIndex + 1;
          const startPosition = cursor.startPosition;
          const endPosition = cursor.endPosition;
          const nodeId = cursor.nodeId;

          let fieldName = cursor.currentFieldName();
          if (fieldName) {
            fieldName += ": ";
          } else {
            fieldName = "";
          }

          row = `<div>${"  ".repeat(
            indentLevel
          )}${fieldName}<a class="plain" href="#" data-id=${nodeId} data-range="${
            startPosition.row
          },${startPosition.column},${endPosition.row},${
            endPosition.column
          }">${displayName}</a> [${startPosition.row + 1}, ${
            endPosition.row + 1
          }] - [${startIndex}, ${endIndex - 1}]`;

          finishedRow = true;
        }

        if (cursor.gotoFirstChild()) {
          visitedChildren = false;
          indentLevel++;
        } else {
          visitedChildren = true;
        }
      }
    }
    if (finishedRow) {
      row += "</div>";
      rows.push(row);
    }

    cursor.delete();
    cluster.update(rows);
    treeRows = rows;
    isRendering--;

    // handleCursorMovement();
  }

  function runTreeQuery(_, startRow, endRow) {
    if (endRow == null) {
      const viewport = codeEditor.getViewport();
      startRow = viewport.from;
      endRow = viewport.to;
    }

    codeEditor.operation(() => {
      const marks = codeEditor.getAllMarks();
      marks.forEach((m) => m.clear());

      if (tree && query) {
        const captures = query.captures(
          tree.rootNode,
          { row: startRow, column: 0 },
          { row: endRow, column: 0 }
        );
        let lastNodeId;
        for (const { name, node } of captures) {
          if (node.id === lastNodeId) continue;
          lastNodeId = node.id;
          const { startPosition, endPosition } = node;
          codeEditor.markText(
            { line: startPosition.row, ch: startPosition.column },
            { line: endPosition.row, ch: endPosition.column },
            {
              inclusiveLeft: true,
              inclusiveRight: true,
              css: `color: ${colorForCaptureName(name)}`,
            }
          );
        }
      }
    });
  }

  function handleQueryChange() {
    if (query) {
      query.delete();
      query.deleted = true;
      query = null;
    }

    queryEditor.operation(() => {
      queryEditor.getAllMarks().forEach((m) => m.clear());
      if (!queryCheckbox.checked) return;

      const queryText = queryEditor.getValue();

      try {
        query = parser.getLanguage().query(queryText);
        let match;

        let row = 0;
        queryEditor.eachLine((line) => {
          while ((match = CAPTURE_REGEX.exec(line.text))) {
            queryEditor.markText(
              { line: row, ch: match.index },
              { line: row, ch: match.index + match[0].length },
              {
                inclusiveLeft: true,
                inclusiveRight: true,
                css: `color: ${colorForCaptureName(match[1])}`,
              }
            );
          }
          row++;
        });
      } catch (error) {
        const startPosition = queryEditor.posFromIndex(error.index);
        const endPosition = {
          line: startPosition.line,
          ch: startPosition.ch + (error.length || Infinity),
        };

        if (error.index === queryText.length) {
          if (startPosition.ch > 0) {
            startPosition.ch--;
          } else if (startPosition.row > 0) {
            startPosition.row--;
            startPosition.column = Infinity;
          }
        }

        queryEditor.markText(startPosition, endPosition, {
          className: "query-error",
          inclusiveLeft: true,
          inclusiveRight: true,
          attributes: { title: error.message },
        });
      }
    });

    runTreeQuery();
    saveQueryState();
  }

  function handleCursorMovement() {
    if (isRendering) return;

    const selection = codeEditor.getDoc().listSelections()[0];
    let start = { row: selection.anchor.line, column: selection.anchor.ch };
    let end = { row: selection.head.line, column: selection.head.ch };
    if (
      start.row > end.row ||
      (start.row === end.row && start.column > end.column)
    ) {
      let swap = end;
      end = start;
      start = swap;
    }
    const node = tree.rootNode.namedDescendantForPosition(start, end);
    if (treeRows) {
      if (treeRowHighlightedIndex !== -1) {
        const row = treeRows[treeRowHighlightedIndex];
        if (row) {
          treeRows[treeRowHighlightedIndex] = row.replace(
            "highlighted",
            "plain"
          );
        }
      }
      treeRowHighlightedIndex = treeRows.findIndex((row) =>
        row.includes(`data-id=${node.id}`)
      );
      if (treeRowHighlightedIndex !== -1) {
        const row = treeRows[treeRowHighlightedIndex];
        if (row) {
          treeRows[treeRowHighlightedIndex] = row.replace(
            "plain",
            "highlighted"
          );
        }
      }
      cluster.update(treeRows);
      const lineHeight = cluster.options.item_height;
      const scrollTop = outputContainerScroll.scrollTop;
      const containerHeight = outputContainerScroll.clientHeight;
      const offset = treeRowHighlightedIndex * lineHeight;
      if (scrollTop > offset - 20) {
        $(outputContainerScroll).animate({ scrollTop: offset - 20 }, 150);
      } else if (scrollTop < offset + lineHeight + 40 - containerHeight) {
        $(outputContainerScroll).animate(
          { scrollTop: offset - containerHeight + 40 },
          150
        );
      }
    }
  }

  function handleTreeClick(event) {
    if (event.target.tagName === "A") {
      event.preventDefault();
      const [startRow, startColumn, endRow, endColumn] =
        event.target.dataset.range.split(",").map((n) => parseInt(n));
      codeEditor.focus();
      codeEditor.setSelection(
        { line: startRow, ch: startColumn },
        { line: endRow, ch: endColumn }
      );
    }
  }

  function handleLoggingChange() {
    if (loggingCheckbox.checked) {
      parser.setLogger((message, lexing) => {
        if (lexing) {
          console.log("  ", message);
        } else {
          console.log(message);
        }
      });
    } else {
      parser.setLogger(null);
    }

    saveStateOnChange();
  }

  function handleQueryEnableChange() {
    if (queryCheckbox.checked) {
      queryContainer.style.visibility = "";
      queryContainer.style.position = "";
    } else {
      queryContainer.style.visibility = "hidden";
      queryContainer.style.position = "absolute";
    }
    handleQueryChange();
  }

  function treeEditForEditorChange(change) {
    const oldLineCount = change.removed.length;
    const newLineCount = change.text.length;
    const lastLineLength = change.text[newLineCount - 1].length;

    const startPosition = { row: change.from.line, column: change.from.ch };
    const oldEndPosition = { row: change.to.line, column: change.to.ch };
    const newEndPosition = {
      row: startPosition.row + newLineCount - 1,
      column:
        newLineCount === 1
          ? startPosition.column + lastLineLength
          : lastLineLength,
    };

    const startIndex = codeEditor.indexFromPos(change.from);
    let newEndIndex = startIndex + newLineCount - 1;
    let oldEndIndex = startIndex + oldLineCount - 1;
    for (let i = 0; i < newLineCount; i++) newEndIndex += change.text[i].length;
    for (let i = 0; i < oldLineCount; i++)
      oldEndIndex += change.removed[i].length;

    return {
      startIndex,
      oldEndIndex,
      newEndIndex,
      startPosition,
      oldEndPosition,
      newEndPosition,
    };
  }

  function colorForCaptureName(capture) {
    const id = query.captureNames.indexOf(capture);
    return COLORS_BY_INDEX[id % COLORS_BY_INDEX.length];
  }

  function loadState() {
    queryInput = localStorage.getItem("query") || "";
    if (
      queryInput == null ||
      (typeof queryInput === "string" && `${queryInput}`.trim().length === 0)
    ) {
      queryInput = `; A Note on anonymous nodes (represented in a query file as strings). As of
; right now, anonymous nodes can not be anchored.
; See https://github.com/tree-sitter/tree-sitter/issues/1461

; Example highlighting for headlines. The headlines here will be matched
; cyclically, easily extended to match however your heart desires.
(headline (stars) @OrgStars1 (#match? @OrgStars1 "^(\\\\*{3})*\\\\*$") (item) @OrgHeadlineLevel1)
(headline (stars) @OrgStars2 (#match? @OrgStars2 "^(\\\\*{3})*\\\\*\\\\*$") (item) @OrgHeadlineLevel2)
(headline (stars) @OrgStars3 (#match? @OrgStars3 "^(\\\\*{3})*\\\\*\\\\*\\\\*$") (item) @OrgHeadlineLevel3)

; This one should be generated after scanning for configuration, using 
; something like #any-of? for keywords, but could use a match if allowing
; markup on todo keywords is desirable.
(item . (expr) @OrgKeywordTodo (#eq? @OrgKeywordTodo "TODO"))
(item . (expr) @OrgKeywordDone (#eq? @OrgKeywordDone "DONE"))

; Not sure about this one with the anchors.
(item . (expr)? . (expr "[" "#" @OrgPriority [ "num" "str" ] @OrgPriority "]") @OrgPriorityCookie (#match? @OrgPriorityCookie "\[#.\]"))

; Match cookies in a headline or listitem. If you want the numbers
; differently highlighted from the borders, add a capture name to "num".
; ([ (item) (itemtext) ] (expr "[" "num"? @OrgCookieNum "/" "num"? @OrgCookieNum "]" ) @OrgProgressCookie (#match? @OrgProgressCookie "^\[\d*/\d*\]$"))
; ([ (item) (itemtext) ] (expr "[" "num"? @OrgCookieNum "%" "]" ) @OrgPercentCookie (#match? @OrgPercentCookie "^\[\d*%\]$"))

(tag_list (tag) @OrgTag) @OrgTagList

(property_drawer) @OrgPropertyDrawer

; Properties are :name: vale, so to color the ':' we can either add them
; directly, or highlight the property separately from the name and value. If
; priorities are set properly, it should be simple to achieve.
(property name: (expr) @OrgPropertyName (value)? @OrgPropertyValue) @OrgProperty

; Simple examples, but can also match (day), (date), (time), etc.
(timestamp "[") @OrgTimestampInactive
(timestamp "<"
  (day)? @OrgTimestampDay
  (date)? @OrgTimestampDate
  (time)? @OrgTimestampTime
  (repeat)? @OrgTimestampRepeat
  (delay)? @OrgTimestampDelay
  ) @OrgTimestampActive

; Like OrgProperty, easy to choose how the '[fn:LABEL] DESCRIPTION' are highlighted
(fndef label: (expr) @OrgFootnoteLabel (description) @OrgFootnoteDescription) @OrgFootnoteDefinition

; Again like OrgProperty to change the styling of '#+' and ':'. Note that they
; can also be added in the query directly as anonymous nodes to style differently.
(directive name: (expr) @OrgDirectiveName (value)? @OrgDirectiveValue) @OrgDirective

(comment) @OrgComment

; At the moment, these three elements use one regex for the whole name.
; So (name) -> :name:, ideally this will not be the case, so it follows the
; patterns listed above, but that's the current status. Conflict issues.
(drawer name: (expr) @OrgDrawerName (contents)? @OrgDrawerContents) @OrgDrawer
(block name: (expr) @OrgBlockName (contents)? @OrgBlockContents) @OrgBlock
(dynamic_block name: (expr) @OrgDynamicBlockName (contents)? @OrgDynamicBlockContents) @OrgDynamicBlock

; Can match different styles with a (#match?) or (#eq?) predicate if desired
(bullet) @OrgListBullet

; Get different colors for different statuses as follows
(checkbox) @OrgCheckbox
(checkbox status: (expr "-") @OrgCheckInProgress)
(checkbox status: (expr "str") @OrgCheckDone (#any-of? @OrgCheckDone "x" "X"))
(checkbox status: (expr) @Error (#not-any-of? @Error "x" "X" "-"))

; If you want the ruler one color and the separators a different color,
; something like this would do it:
; (hr "|" @OrgTableHRBar) @OrgTableHorizontalRuler
(hr) @OrgTableHorizontalRuler

; Can do all sorts of fun highlighting here..
(cell (contents . (expr "=")) @OrgCellFormula (#match? @OrgCellFormula "^\d+([.,]\d+)*$"))

; Dollars, floats, etc. Strings.. all options to play with
(cell (contents . (expr "num") @OrgCellNumber (#match? @OrgCellNumber "^\d+([.,]\d+)*$") .))

(paragraph [
  ((expr "*" @bold.start) (expr "*" @bold.end))
  (expr "*" @bold.start "*" @bold.end)
  ((expr "~" @code.start) (expr "~" @code.end))
  (expr "~" @code.start "~" @code.end)
  ((expr "/" @italic.start) (expr "/" @italic.end))
  (expr "/" @italic.start "/" @italic.end)
  ((expr "_" @underline.start) (expr "_" @underline.end))
  (expr "_" @underline.start "_" @underline.end)
  ((expr "=" @verbatim.start) (expr "=" @verbatim.end))
  (expr "=" @verbatim.start "=" @verbatim.end)
  ((expr "+" @strikethrough.start) (expr "+" @strikethrough.end))
  (expr "+" @strikethrough.start "+" @strikethrough.end)
])

; headline item
(item [
  ((expr "*" @bold.start) (expr "*" @bold.end))
  (expr "*" @bold.start "*" @bold.end)
  ((expr "~" @code.start) (expr "~" @code.end))
  (expr "~" @code.start "~" @code.end)
  ((expr "/" @italic.start) (expr "/" @italic.end))
  (expr "/" @italic.start "/" @italic.end)
  ((expr "_" @underline.start) (expr "_" @underline.end))
  (expr "_" @underline.start "_" @underline.end)
  ((expr "=" @verbatim.start) (expr "=" @verbatim.end))
  (expr "=" @verbatim.start "=" @verbatim.end)
  ((expr "+" @strikethrough.start) (expr "+" @strikethrough.end))
  (expr "+" @strikethrough.start "+" @strikethrough.end)
])
`;
    }
    codeInput = localStorage.getItem("sourceCode") || "";
    if (
      codeInput == null ||
      (typeof codeInput === "string" && `${codeInput}`.trim().length === 0)
    ) {
      codeInput = `using System;
namespace HelloWorld
{
  class Program
  {
    static void Main(string[] args)
    {
      Console.WriteLine("Hello World!");
    }
  }
}`;
    }
    languageSelect.value = localStorage.getItem("language") || "csharp";
    queryCheckbox.checked = localStorage.getItem("queryEnabled") === "true";
    loggingCheckbox.checked = localStorage.getItem("loggingEnabled") === "true";
  }

  function saveState() {
    localStorage.setItem("language", languageSelect.value);
    localStorage.setItem("sourceCode", codeEditor.getValue());
    localStorage.setItem("loggingEnabled", loggingCheckbox.checked);
    saveQueryState();
  }

  function saveQueryState() {
    localStorage.setItem("queryEnabled", queryCheckbox.checked);
    localStorage.setItem("query", queryEditor.getValue());
  }

  function debounce(func, wait, immediate) {
    var timeout;
    return function () {
      var context = this,
        args = arguments;
      var later = function () {
        timeout = null;
        if (!immediate) func.apply(context, args);
      };
      var callNow = immediate && !timeout;
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
      if (callNow) func.apply(context, args);
    };
  }
})();
