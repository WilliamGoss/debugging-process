import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

export function createGraph(treeData, aNode, nCount) {
    let nodes = treeData;
    let activeNode = aNode;
    let nodeCount = nCount;

    // Set up the canvas
const canvas = document.getElementById("canvas");
const context = canvas.getContext("2d");
const vscode = acquireVsCodeApi();

// Initial canvas offset (for dragging)
let offsetX = 0;
let offsetY = 0;

// Flags for dragging state
let isDraggingCanvas = false;
let isDraggingNode = false;
let dragStartX = 0;
let dragStartY = 0;
let draggedNode = null;
let movedNode = null;

// Function to set canvas size to the window size
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  drawNodes(); // Redraw the nodes to match the new size
}

// Node dimensions
const nodeSize = 100;
const padding = 10;

// Precompute wrapped text for all nodes
nodes.forEach(node => {
  node.wrappedText = getWrappedText(context, node.text, nodeSize - 2 * padding);
});

// Function to calculate wrapped text
function getWrappedText(ctx, text, maxWidth) {
  const words = text.split(" ");
  let line = "";
  const lines = [];

  words.forEach(word => {
    const testLine = line + word + " ";
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth) {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = testLine;
    }
  });

  if (line) {
    lines.push(line.trim());
  }

  return lines;
}

// Draw all nodes
function drawNodes() {

  context.clearRect(0, 0, canvas.width, canvas.height);

  nodes.forEach(node => {
    // Draw the square (offset by current dragging)
    context.beginPath();
    context.rect(node.x - nodeSize / 2 + offsetX, node.y - nodeSize / 2 + offsetY, nodeSize, nodeSize);
    context.fillStyle = node.id === activeNode ? "lightblue" : "white";
    context.fill();
    context.stroke();

    // Draw the precomputed wrapped text
    drawWrappedText(context, node.wrappedText, node.x + offsetX, node.y + offsetY, 14);
  });
}

//active node helper function
function changeActiveNode(nodeId, commitId, branchId) {
  activeNode = nodeId; 
  vscode.postMessage({ command: 'updateActiveNode', activeNode: nodeId, commitId: commitId, branchId: branchId});
};

//update x and y node coordinates
function updateXY(nodeId, newX, newY) {
  vscode.postMessage({ command: "updateXY", nodeId: nodeId, x: newX, y: newY });
}

// Text drawing helper
function drawWrappedText(ctx, lines, x, y, lineHeight) {
  const totalHeight = lines.length * lineHeight;
  const startY = y - totalHeight / 2 + lineHeight / 2;
  lines.forEach((line, index) => {
    ctx.fillStyle = "black";
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(line, x, startY + index * lineHeight);
  });
}

// Check if the point is inside a node (with offsets)
function isInsideNode(x, y, node) {
  return (
    x > node.x - nodeSize / 2 + offsetX &&
    x < node.x + nodeSize / 2 + offsetX &&
    y > node.y - nodeSize / 2 + offsetY &&
    y < node.y + nodeSize / 2 + offsetY
  );
}

// Mouse event handlers for dragging canvas and nodes
canvas.addEventListener("mousedown", event => {
  const [x, y] = d3.pointer(event, canvas);
  
  // Check if the click is inside a node (prioritize node dragging)
  draggedNode = nodes.find(node => isInsideNode(x, y, node));
  
  if (draggedNode) {
    movedNode = draggedNode.id;
    isDraggingNode = true; // Start dragging the node
    dragStartX = x;
    dragStartY = y;
    draggedNode.initialX = draggedNode.x;
    draggedNode.initialY = draggedNode.y;
  } else {
    isDraggingCanvas = true; // Start dragging the canvas
    dragStartX = x;
    dragStartY = y;
  }
});

canvas.addEventListener("mousemove", event => {
  if (isDraggingCanvas) {
    const [x, y] = d3.pointer(event, canvas);
    const dx = x - dragStartX;
    const dy = y - dragStartY;
    offsetX += dx;
    offsetY += dy;
    dragStartX = x;
    dragStartY = y;
    drawNodes(); // Redraw nodes after dragging canvas
  }

  if (isDraggingNode && draggedNode) {
    const [x, y] = d3.pointer(event, canvas);
    draggedNode.x = x - offsetX;
    draggedNode.y = y - offsetY;
    drawNodes(); // Redraw nodes after dragging a node
  }
});

canvas.addEventListener("mouseup", () => {
  if (isDraggingNode) {
    if (draggedNode.x !== draggedNode.initialX || draggedNode.y !== draggedNode.initialY) {
      updateXY(movedNode, draggedNode.x, draggedNode.y);
    }
  }
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
  movedNode = null;
});

canvas.addEventListener("mouseleave", () => {
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
});

// Double-click to set active node
canvas.addEventListener("dblclick", event => {
  const [x, y] = d3.pointer(event, canvas);
  const clickedNode = nodes.find(node => isInsideNode(x, y, node));
  if (clickedNode) {
    activeNode = clickedNode.id;
    changeActiveNode(clickedNode.id, clickedNode.commitId, clickedNode.branchId);
    drawNodes();
  }
});

// Listen for window resize and adjust the canvas size
window.addEventListener("resize", resizeCanvas);

//TODO: Find what is calling the updateGraph twice when running a node with changes
window.addEventListener('message', event => {
  const message = event.data;
  if (message.command === 'attachCommit') {
    // A new commit was made, so the latest node needs to have it attached
    let node = nodes.find(n => n.id === message.nodeId);
    node.commitId = message.commitId;  
    node.branchId = message.branchId;
  }
  if (message.command === 'updateGraph' && Array.isArray(message.treeData)) {
      let updatedActiveNode = message.activeNode;
      let newTree = message.treeData;
      activeNode = updatedActiveNode;
      nodes = newTree;
      nodes.forEach(node => {
        node.wrappedText = getWrappedText(context, node.text, nodeSize - 2 * padding);
      });
      drawNodes();
  } else if (message.command === 'updateNodeText') {
    let node = nodes.find(n => n.id === message.nodeId);
    if (node) {
        node.text = message.newText;
        node.wrappedText = getWrappedText(context, node.text, nodeSize - 2 * padding);

        // Clear only the node's region
        context.clearRect(node.x - nodeSize / 2 + offsetX - 1, 
                          node.y - nodeSize / 2 + offsetY - 1, 
                          nodeSize + 2, nodeSize + 2);

        // Redraw only this node
        context.beginPath();
        context.rect(node.x - nodeSize / 2 + offsetX, node.y - nodeSize / 2 + offsetY, nodeSize, nodeSize);
        context.fillStyle = node.id === activeNode ? "lightblue" : "white";
        context.fill();
        context.stroke();

        // Redraw the text inside the node
        drawWrappedText(context, node.wrappedText, node.x + offsetX, node.y + offsetY, 14);
    }
  }
});

// Initial setup
resizeCanvas();
}