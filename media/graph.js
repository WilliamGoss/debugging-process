import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

export function createGraph(treeData, aNode, nCount) {
    let nodes = treeData;
    let activeNode = aNode;
    let nodeCount = nCount;

    // Set up the canvas
    const canvas = document.getElementById("canvas");
    const penButton = document.getElementById("penButton");
    const cursorButton = document.getElementById("cursorButton");
    const context = canvas.getContext("2d");
    const vscode = acquireVsCodeApi();

    // Initial canvas offset (for dragging)
    let offsetX = 0;
    let offsetY = 0;

    // Initial Zoom setting
    let zoomLevel = 1;

    // Flags for dragging state
    let isDraggingCanvas = false;
    let isDraggingNode = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let draggedNode = null;
    let movedNode = null;
    let canvasOffsetX = 0;
    let canvasOffsetY = 0;
    let canvasDragStartX = 0;
    let canvasDragStartY = 0;
    let currentOffsetX = 0;
    let currentOffsetY = 0;
    let initialOffsetX = 0;
    let initialOffsetY = 0;

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

let nodeDivs = [];

// Draw all nodes
function drawNodes() {

  context.setTransform(zoomLevel, 0, 0, zoomLevel, 0, 0);

  // Create nodes only once
  nodes.forEach((node, index) => {
    // EXPERIMENTAL
    let xPos = (node.x - nodeSize / 2) + offsetX;
    let yPos = (node.y - nodeSize / 2) + offsetY;

    // Check if the div for the node already exists
    let nodeDiv = nodeDivs[index];

    if (!nodeDiv) {
      // If the div doesn't exist, create a new one
      nodeDiv = document.createElement('div');
      nodeDiv.classList.add('node-text');
      nodeDiv.style.position = 'absolute';
      nodeDiv.style.width = `${nodeSize}px`;
      nodeDiv.style.height = `${nodeSize}px`;
      nodeDiv.style.overflow = 'auto'; // Make the text scrollable
      nodeDiv.style.textAlign = 'left';
      nodeDiv.style.padding = `${padding}px`;
      //nodeDiv.style.fontSize = '14px';
      nodeDiv.style.lineHeight = '1.2em';
      nodeDiv.setAttribute('data-id', node.id);
      nodeDivs[index] = nodeDiv; // Store reference to the created div
      document.body.appendChild(nodeDiv);

      // Set the text content
      nodeDiv.innerHTML = node.wrappedText.join('<br>'); // Join wrapped text with line breaks
    }

    // Apply zoom to the node div position
    nodeDiv.style.top = `${yPos * zoomLevel + offsetY}px`;
    nodeDiv.style.left = `${xPos * zoomLevel + offsetX}px`;

    // Adjust the size of the node div based on zoom level
    const scaledNodeSize = nodeSize * zoomLevel;
    nodeDiv.style.width = `${scaledNodeSize}px`;
    nodeDiv.style.height = `${scaledNodeSize}px`;

    // Scale the font size based on zoom level
    const scaledFontSize = 14 * zoomLevel; // Adjust the base font size (14px) as needed
    nodeDiv.style.fontSize = `${scaledFontSize}px`;

    // Update position for the existing div
    //nodeDiv.style.top = `${node.y - nodeSize / 2 + offsetY}px`;
    //nodeDiv.style.left = `${node.x - nodeSize / 2 + offsetX}px`;

    // Update node div's appearance based on active state
    nodeDiv.style.backgroundColor = node.id === activeNode ? 'lightblue' : 'white';
    nodeDiv.style.border = '1px solid black';
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
document.body.addEventListener("mousedown", event => {
  if (event.target && event.target.classList.contains("node-text")) {
    // Start dragging a node
    draggedNode = nodes.find(node => String(node.id) === event.target.dataset.id);
    if (draggedNode) {
      movedNode = draggedNode.id;
      isDraggingNode = true;

      dragStartX = event.clientX;
      dragStartY = event.clientY;

      draggedNode.initialX = draggedNode.x; // Store initial position *without* offset
      draggedNode.initialY = draggedNode.y;

      draggedNode.offsetXInNode = event.clientX - (draggedNode.x + offsetX - nodeSize / 2);
      draggedNode.offsetYInNode = event.clientY - (draggedNode.y + offsetY - nodeSize / 2);

      // Store the initial node position *relative to the current offset*:
      if (event.target && event.target.classList.contains("node-text")) {
        draggedNode.initialXWithOffset = draggedNode.x + offsetX + canvasOffsetX;
        draggedNode.initialYWithOffset = draggedNode.y + offsetY + canvasOffsetY;
      }
    }
  } else {
    // Start dragging the canvas (if clicking on an empty area)
    isDraggingCanvas = true;
    canvasDragStartX = event.clientX;
    canvasDragStartY = event.clientY;
    initialOffsetX = offsetX; // Store initial offset values
    initialOffsetY = offsetY;
  }
});

document.body.addEventListener("mousemove", event => {
  if (isDraggingCanvas) {
    const dx = event.clientX - canvasDragStartX;
    const dy = event.clientY - canvasDragStartY;

    offsetX = initialOffsetX + dx; // Calculate new offset
    offsetY = initialOffsetY + dy;

    drawNodes();
  }

  if (isDraggingNode && draggedNode) {
    const dx = (event.clientX - dragStartX) / zoomLevel;
    const dy = (event.clientY - dragStartY) / zoomLevel;

    draggedNode.x = draggedNode.initialX + dx; // Update node position relative to initial
    draggedNode.y = draggedNode.initialY + dy;

    drawNodes();

    //event.target.style.cursor = 'grabbing';
  }
});

document.body.addEventListener("mouseup", () => {
  if (isDraggingCanvas) {
    currentOffsetX = offsetX; // Save current offset
    currentOffsetY = offsetY;
    isDraggingCanvas = false;
  }
  if (isDraggingNode && draggedNode) {
    if (draggedNode.x !== draggedNode.initialX || draggedNode.y !== draggedNode.initialY) {
      updateXY(movedNode, draggedNode.x, draggedNode.y);
    }
  }
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
  movedNode = null;
});

document.body.addEventListener("mouseleave", () => {
  isDraggingCanvas = false;
  isDraggingNode = false;
  draggedNode = null;
});

// Double-click to set active node
document.body.addEventListener("dblclick", event => {
  if (event.target && event.target.classList.contains("node-text")) {
    const reversedNodes = [...nodes].reverse();
    let dblClickedNode = reversedNodes.find(node => String(node.id) === event.target.dataset.id);
    activeNode = dblClickedNode.id;
    changeActiveNode(dblClickedNode.id, dblClickedNode.commitId, dblClickedNode.branchId);
    drawNodes();
  }
});

// Zooming with mouse wheel
document.body.addEventListener("wheel", (event) => {
  const zoomSpeed = 0.1;
  if (event.deltaY < 0) {
    //Scroll up (zoom in)
    zoomLevel += zoomSpeed;
  } else {
    zoomLevel = Math.max(zoomLevel - zoomSpeed, 0.1);
  }
  canvas.style.transform = `scale(${zoomLevel})`;
  drawNodes();
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
        const nodeDiv = document.querySelector(`.node-text[data-id="${node.id}"]`);
        if (nodeDiv) {
          nodeDiv.innerHTML = node.wrappedText.join('<br>');
        }
    }
  }
});

penButton.addEventListener("mousedown", (event) => {
  event.stopPropagation();
});

cursorButton.addEventListener("mousedown", (event) => {
  event.stopPropagation();
});

// Initial setup
resizeCanvas();
}