// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  let workSpaceName = workspaceData;

  //get node tree state
  let nodes;
  let nodeCount;
  let activeNode;
  let root;
  const oldState = vscode.getState() || { nodesData: { root: 0, nodeCount: 0, activeNode: 0, nodes: {} } };
  if ("nodes" in oldState) {
      nodes = oldState.nodes;
      nodeCount = oldState.nodeCount;
      activeNode = oldState.activeNode;
      root = oldState.root;
  } else {
      //stale data
      vscode.setState({ root: -1, nodeCount: nodeCount, activeNode: activeNode, nodes: {} });
      nodes = [];
      nodeCount = 0;
      activeNode = 0;
      root = -1;
  }
  //const oldState = { treeData: {}, nodeCount: 0, activeNode: 0 };

  let viewId = '';

  document.body.innerHTML = `
      <div id="view0" class="hidden">
          <p> Please select a workspace to continue. </p>
      </div>
      <div id="view1" class="hidden">
          <p>Describe your issue and then click 'Open Issue' to start.</p>
          <br/>
          <textarea cols="40" rows="5"></textarea>
          <br/>
          <button id="startIssue">Open Issue</button>
          <br/>
      </div>
      <div id="view2" class="hidden">
      <br/>
      <button id="showTreeButton">Show Graph</button>
      <br/>
          <br/>
          <hr/>
          <br/>
          <div class="diff">
          </div>
          <br/>
          <br/>
          <div class="hidden">
              <button id="fileChanged"></button><p> File Changed</p>
              <br/>
              <button id="pyRun"></button>
              <p>    </p> <p> Python Ran</p>
              <br/>
              <p> Nodes in state: </p><p id="htmlCount">0</p>
              <br/>
              <p> Initial Node: </p> <p id="firstNode">None</p>
              <br/>
              <br/>
              <button id="clearStatus">Clear Status</button>
          </div>
      </div>
  `;

  // Call the function to update textarea with the node's name
  updateExplorationText();

  // @ts-ignore: Object is possibly 'null'.
  document.getElementById('startIssue').addEventListener('click', () => { showView('view2'); createNewIssue(); });
  /* Overall View */
  // @ts-ignore: Object is possibly 'null'.
  document.getElementById('showTreeButton').addEventListener('click', () => showTree(nodes));

  /* TESTING ONLY */
  //document.getElementById('clearState')?.addEventListener('click', () => emptyState());
  //document.getElementById('clearStatus')?.addEventListener('click', () => resetStatus());

  showView(nodes);

  function showView(nodes) {
      if (workSpaceName === "null") {
          viewId = 'view0';
      }
      else if (Object.keys(nodes).length === 0) {
          viewId = 'view1';
      } else {
          viewId = 'view2';
      }
      const views = ['view0', 'view1', 'view2'];
      views.forEach(view => {
          // @ts-ignore: Object is possibly 'null'.
          document.getElementById(view).classList.toggle('visible', view === viewId);
          // @ts-ignore: Object is possibly 'null'.
          document.getElementById(view).classList.toggle('hidden', view !== viewId);
      });
  }

  // Handle messages sent from the extension to the webview
  window.addEventListener('message', event => {
      const message = event.data; // The json data that the extension sent
      switch (message.type) {
          case 'activeNode':
              {
                  activeNode = message.data;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: message.data, nodes: nodes });
                  updateExplorationText();
                  break;
              }
          case 'addNode':
              {
                  let newNode = { text: "New Node", id: nodeCount, commitId: "", x: 0, y: 0, children: [], visible: true };
                  nodes[nodeCount] = newNode;
                  nodes[message.data].children.push(nodeCount);
                  nodeCount = nodeCount + 1;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes });
                  vscode.postMessage({ type: 'updateGraph', command: "showD3Graph", treeData: nodes, activeNode: activeNode });
                  break;
              }
          case 'attachCommit':
              {
                  const nodeToUpdate = message.data.nodeId;
                  const commitId = message.data.commitId;
                  const branchId = message.data.branchId;
                  nodes[nodeToUpdate].commitId = commitId;
                  nodes[nodeToUpdate].branchId = branchId;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes });
                  vscode.postMessage({ type: 'updateGraph', command: "showD3Graph", treeData: nodes, activeNode: activeNode });
                  break;
              }
          case 'autoCreateNode':
              {
                  const runData = JSON.parse(message.data);
                  // if viewId is blank or not set to view2, it means a bug hasn't been declared yet
                  // it should return as we do not want nodes created until a bug is declared
                  if (viewId === '' || viewId !== "view2") { return; }
                  // When automatically creating a new node we want to position it
                  // directly underneath the currently active node rather than
                  // arbitrarily offsetting it by a fixed amount.  The card
                  // height for a node depends on whether it is in an expanded
                  // state and whether it has runtime output or errors to show.
                  // Use the same base height that the React canvas uses for a
                  // collapsed card (100px) and add extra vertical space for
                  // any expanded output or error panels.  The size estimates
                  // here mirror the logic in App.tsx: the Collapse for
                  // runtime information shows a MUI TextField with between 1
                  // and 5 rows of text, so we approximate ~20px per row plus
                  // a small base height for the label and padding.  This
                  // prevents newly created nodes from overlapping with their
                  // parent when the parent is expanded.
                  const parentNode = nodes[activeNode];
                  // Approximate the height of the parent card based on the
                  // amount of text it contains.  We assume around 30
                  // characters per line within the 250px‑wide card and
                  // allocate about 20px per line.  A base spacing of 60px
                  // accounts for the card padding, the chevron, and a
                  // single line of text.  This makes the vertical gap
                  // consistent for cards with very little text and cards
                  // containing multiple lines.
                  // The following constants are chosen to better match the
                  // actual sizing of the Material UI card used in the
                  // React canvas.  Each line of text occupies roughly
                  // 24px vertically, and the card has about 80px of
                  // intrinsic padding, margins and header space.  We
                  // estimate that roughly 30 characters fit on a line
                  // before wrapping.  These values were tuned so that
                  // cards with long text no longer collide with their
                  // children and cards with short/medium text produce
                  // reasonably similar gaps.
                  const APPROX_CHARS_PER_LINE = 26;
                  const TEXT_ROW_HEIGHT = 24;
                  const BASE_SPACING = 80;
                  let textHeight = 0;
                  if (parentNode && typeof parentNode.text === 'string') {
                      const textLines = String(parentNode.text).split(/\r\n|\n|\r/);
                      let totalLines = 0;
                      for (const line of textLines) {
                          const len = line.length;
                          const linesForThis = Math.max(1, Math.ceil(len / APPROX_CHARS_PER_LINE));
                          totalLines += linesForThis;
                      }
                      textHeight = BASE_SPACING + TEXT_ROW_HEIGHT * totalLines;
                  } else {
                      // fall back to a reasonable default for empty text
                      textHeight = BASE_SPACING + TEXT_ROW_HEIGHT;
                  }
                  let cardHeight = textHeight;
                  // If the card is expanded, add height for runtime output and error panels
                  const ROW_HEIGHT = 20;
                  const FIELD_BASE = 30;
                  if (parentNode && parentNode.expanded) {
                      let extraHeight = 0;
                      const hasOutput = parentNode.runOutput && String(parentNode.runOutput).trim().length > 0;
                      const hasError = parentNode.runError && String(parentNode.runError).trim().length > 0;
                      if (hasOutput) {
                          const cleanOutput = String(parentNode.runOutput).replace(/\r\n/g, '\n').replace(/\n+$/, '');
                          const outputLines = cleanOutput.length ? cleanOutput.split('\n').length : 1;
                          const rows = Math.min(5, outputLines);
                          extraHeight += FIELD_BASE + ROW_HEIGHT * rows;
                      }
                      if (hasError) {
                          const cleanError = String(parentNode.runError).replace(/\r\n/g, '\n').replace(/\n+$/, '');
                          const errorLines = cleanError.length ? cleanError.split('\n').length : 1;
                          const rows = Math.min(5, errorLines);
                          extraHeight += FIELD_BASE + ROW_HEIGHT * rows;
                      }
                      cardHeight += extraHeight;
                  }
                  // Add a small margin so that cards don't touch
                  const MARGIN = 10;
                  const newYValue = parentNode ? parentNode.y + cardHeight + MARGIN : 0;
                  // Align the new node horizontally with its parent
                  const newXValue = parentNode ? parentNode.x : 0;
                  let newNode = { text: "Generating summary...", id: nodeCount, commitId: "", branchId: "", x: newXValue, y: newYValue, children: [], visible: true, runOutput: runData.stdout, runError: runData.stderr, diffs: null, expanded: false };
                  //change active node to the new node
                  let newActiveNode = nodeCount;
                  nodes[nodeCount] = newNode;
                  let parentCommit = nodes[activeNode].commitId;
                  nodes[activeNode].children.push(nodeCount);
                  let childCheck = nodes[activeNode].children.length;
                  let parentBranch = nodes[activeNode].branchId;
                  nodeCount = nodeCount + 1;
                  activeNode = newActiveNode;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: newActiveNode, nodes: nodes });
                  updateExplorationText();
                  let nodeArray = Object.values(nodes);
                  vscode.postMessage({ type: 'updateGraph', command: "showD3Graph", treeData: nodeArray, activeNode: newActiveNode });
                  /* debug stuff */
                  document.getElementById('htmlCount').innerHTML = nodeCount;
                  document.getElementById('fileChanged').style.background = 'DodgerBlue';
                  document.getElementById('pyRun').style.background = 'DodgerBlue';
                  vscode.postMessage({ type: 'createCommit', command: "showD3Graph", activeNode: activeNode, childCheck: childCheck, parentBranch: parentBranch, parentCommit: parentCommit });
                  break;
              }
          case 'fileChanged':
              {
                  document.getElementById('fileChanged').style.background = 'MediumSeaGreen';
                  break;
              }
          case 'pythonRan':
              {
                  document.getElementById('pyRun').style.background = 'MediumSeaGreen';
                  break;
              }
          case 'resetNewNodeDebug':
              {
                  resetStatus();
                  break;
              }
          case 'workSpaceInfo':
              {
                  workSpaceName = message.data;
                  showView(nodes);
                  break;
              }
          case 'updateXY':
              {
                  const nodeToUpdate = message.data.nodeId;
                  const newNodeX = message.data.x;
                  const newNodeY = message.data.y;
                  nodes[nodeToUpdate].x = newNodeX;
                  nodes[nodeToUpdate].y = newNodeY;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes });
                  break;
              }

          case 'hideNode':
              {
                  const nodeToUpdate = message.data;
                  nodes[nodeToUpdate].visible = false;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes });
                  break;
              }
          case 'triggerExport':
              {
                  // Export the data
                  vscode.postMessage({ type: 'getExport', treeData: nodes });
                  // Reset the data
                  vscode.setState({ root: -1, nodeCount: 0, activeNode: 0, nodes: {} });
                  nodes = {};
                  nodeCount = 0;
                  activeNode = 0;
                  root = -1;
                  // Change view back to initial
                  showView(nodes);
                  // Close visual if it's open
                  break;
              }
          case 'updateSummary':
              {
                  //Update the node
                  const nodeToUpdate = message.data.nodeId;
                  const summarizationOfChanges = message.data.changeLog[0];
                  const diffObject = message.data.changeLog[1];
                  const hunks = buildHunksFromParts(diffObject, 2).map(h => clampHunk(h, 100));
                  nodes[nodeToUpdate].text = summarizationOfChanges;
                  nodes[nodeToUpdate].diffs = hunks;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes });
                  //Also update the side bar
                  updateExplorationText();
                  break;
              }
          case 'updateExpandState':
              {
                  const nodeToUpdate = message.data.nodeId;
                  const expandState = message.data.expandState;
                  nodes[nodeToUpdate].expanded = expandState;
                  vscode.setState({ root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes });
                  break;
              }
            case 'updateNodeText':
              {
                const nodeToUpdate = message.data.nodeId;
                const newText = message.data.nodeText;
                nodes[nodeToUpdate].text = newText;
                vscode.setState({ root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes });
                break;
              }
      }
  });

  function createNewIssue() {
      const textAreaObject = document.querySelector('#view1 textarea');
      const userIssueText = textAreaObject.value;
      let newNodes = {};
      newNodes[0] = { text: userIssueText, id: 0, commitId: "", branchId: "", x: 0, y: 0, children: [], visible: true, runOutput: null, runError: null, diffs: null, expanded: false };
      nodeCount = nodeCount + 1;
      //update the local global variables: nodes, activeNode, root
      nodes = newNodes;
      activeNode = 0;
      root = 0;
      vscode.setState({ root: 0, nodeCount: nodeCount, activeNode: 0, nodes: newNodes });
      textAreaObject.value = '';
      updateExplorationText();
      vscode.postMessage({ type: 'initializeRepo' });
  }

  /* For testing only! */
  function emptyState() {
      nodeCount = 0;
      activeNode = 0;
      vscode.setState({ root: -1, nodeCount: nodeCount, activeNode: activeNode, nodes: {} });
      showView([]);
      localStorage.clear();
      vscode.postMessage({ type: 'removeRepo' });
  }

  /* Testing */
  function resetStatus() {
      document.getElementById('fileChanged').style.background = 'DodgerBlue';
      document.getElementById('pyRun').style.background = 'DodgerBlue';
  }

  function showTree(nodes) {
      const nodeArray = Object.values(nodes);
      vscode.postMessage({ type: 'showGraph', command: "showD3Graph", treeData: nodeArray, activeNode: activeNode });
  }

  //updates the text in the box with the selected node -- used when a new active node is selected or on the initial extension load
  function updateExplorationText() {
      const node = nodes[activeNode];
      if (!node) { return; }

      const textarea = document.querySelector('#view2 textarea[name="exploration"]');
      if (textarea) { textarea.value = node.text || ''; }

      const diffContainer = document.querySelector('#view2 .diff');
      // If you also have clampHunk, you can do: const hunks = (node.hunks||[]).map(h => clampHunk(h, 100));
      renderDiff(node.diffs || [], diffContainer);
  }

  //diff object into hunks
  function buildHunksFromParts(parts, context = 2) {
      const hunks = [];
      let oldLn = 1;
      let newLn = 1;
    
      let bufferedCommon = null; // { lines, oldStart, newStart }
      let openHunk = null;       // { oldStart, newStart, lines[] }
    
      const splitLines = (s) => {
        const arr = s.split('\n');
        if (arr.length && arr[arr.length - 1] === '') { arr.pop(); }// drop trailing empty
        return arr;
      };
    
      const addCtxHead = (take) => {
        if (!bufferedCommon || !openHunk) { return; }
        const lines = bufferedCommon.lines;
        const oldStart = bufferedCommon.oldStart;
        const newStart = bufferedCommon.newStart;
        const n = Math.min(take, lines.length);
        for (let i = 0; i < n; i++) {
          openHunk.lines.push({
            kind: 'ctx',
            text: lines[i],
            oldNo: oldStart + i,
            newNo: newStart + i
          });
        }
        bufferedCommon = {
          lines: lines.slice(n),
          oldStart: oldStart + n,
          newStart: newStart + n
        };
      };
    
      const addCtxTail = (take) => {
        if (!bufferedCommon || !openHunk) { return; }
        const lines = bufferedCommon.lines;
        const oldStart = bufferedCommon.oldStart;
        const newStart = bufferedCommon.newStart;
        const n = Math.min(take, lines.length);
        const start = Math.max(0, lines.length - n);
        for (let i = start; i < lines.length; i++) {
          openHunk.lines.push({
            kind: 'ctx',
            text: lines[i],
            oldNo: oldStart + i,
            newNo: newStart + i
          });
        }
        bufferedCommon = null; // consumed as tail
      };
    
      const startHunkIfNeeded = () => {
        if (openHunk) { return; }
        let oldStart = oldLn;
        let newStart = newLn;
        if (bufferedCommon) {
          const L = bufferedCommon.lines.length;
          const used = Math.min(context, L);
          oldStart = bufferedCommon.oldStart + Math.max(0, L - used);
          newStart = bufferedCommon.newStart + Math.max(0, L - used);
        }
        openHunk = { oldStart, newStart, lines: [] };
        if (bufferedCommon) { addCtxTail(context); }
      };
    
      const closeHunk = () => {
        if (!openHunk) { return; }
        if (bufferedCommon) { addCtxHead(context); }
        hunks.push(openHunk);
        openHunk = null;
        bufferedCommon = null;
      };
    
      let i = 0;
      while (i < parts.length) {
        const part = parts[i];
        const lines = splitLines(part.value);
    
        if (!part.added && !part.removed) {
          // common block
          bufferedCommon = { lines, oldStart: oldLn, newStart: newLn };
          oldLn += lines.length;
          newLn += lines.length;
          if (openHunk) { addCtxHead(context); }
          i++;
          continue;
        }
    
        // change block
        startHunkIfNeeded();
    
        // Replace case: removed followed by added
        if (part.removed && i + 1 < parts.length && parts[i + 1].added) {
          const delLines = lines;
          const addLines = splitLines(parts[i + 1].value);
    
          for (let k = 0; k < delLines.length; k++) {
            openHunk.lines.push({ kind: 'del', text: delLines[k], oldNo: oldLn + k });
          }
          for (let k = 0; k < addLines.length; k++) {
            openHunk.lines.push({ kind: 'add', text: addLines[k], newNo: newLn + k });
          }
    
          oldLn += delLines.length;
          newLn += addLines.length;
    
          i += 2;
          continue;
        }
    
        // Pure delete
        if (part.removed) {
          for (let k = 0; k < lines.length; k++) {
            openHunk.lines.push({ kind: 'del', text: lines[k], oldNo: oldLn + k });
          }
          oldLn += lines.length;
          i++;
          continue;
        }
    
        // Pure add
        if (part.added) {
          for (let k = 0; k < lines.length; k++) {
            openHunk.lines.push({ kind: 'add', text: lines[k], newNo: newLn + k });
          }
          newLn += lines.length;
          i++;
          continue;
        }
      }
    
      if (openHunk) { closeHunk(); }
      return hunks;
    }
    
    // Optional: clamp very large hunks
    function clampHunk(h, maxLines = 80) {
      if (h.lines.length <= maxLines) { return h; }
      const keep = Math.floor(maxLines / 2);
      return {
        ...h,
        lines: [
          ...h.lines.slice(0, keep),
          { kind: 'ctx', text: '…', oldNo: undefined, newNo: undefined },
          ...h.lines.slice(-keep)
        ]
      };
    }

// --- rendering helpers ---
function renderHunk(h) {
  const header = document.createElement('div');
  header.className = 'hunk-header';
  header.textContent = `@@ -${h.oldStart} +${h.newStart} @@`;

  const body = document.createElement('div');
  body.className = 'code';

  (h.lines || []).forEach(line => {
    const row = document.createElement('div');
    row.className = `row ${line.kind}`;

    const oldCell = document.createElement('div');
    oldCell.className = 'ln';
    oldCell.textContent = line.oldNo ?? '';

    const newCell = document.createElement('div');
    newCell.className = 'ln';
    newCell.textContent = line.newNo ?? '';

    const text = document.createElement('div');
    text.className = 'code-text';
    const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
    // textContent preserves literal code (no HTML injection)
    text.textContent = (sign + ' ' + (line.text ?? '')).replace(/\t/g, '  ');

    row.appendChild(oldCell);
    row.appendChild(newCell);
    row.appendChild(text);
    body.appendChild(row);
  });

  const wrap = document.createElement('div');
  wrap.className = 'hunk';
  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function renderDiff(hunks, container) {
  if (!container) { return; }
  container.innerHTML = '';

  if (!hunks || hunks.length === 0) {
    const msg = document.createElement('div');
    msg.style.color = '#666';
    msg.style.fontSize = '12px';
    msg.textContent = 'No changes.';
    container.appendChild(msg);
    return;
  }
  hunks.forEach(h => container.appendChild(renderHunk(h)));
}

}());


