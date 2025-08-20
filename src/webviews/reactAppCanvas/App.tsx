import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { Card, CardContent, Typography, Button, TextField, Collapse } from "@mui/material";

/*
 * NOTE:
 * This component implements an "infinite" canvas with pan/zoom and
 * individually draggable nodes. Instead of relying on external pan/zoom
 * libraries, we keep track of the current transform (translation and
 * scale) ourselves and update it in response to pointer and wheel
 * events. Nodes are positioned in world coordinates (x, y) and the
 * wrapper div is transformed so that all nodes move together when
 * panning or zooming. When a node is dragged we update its world
 * coordinates without affecting the global translation.
 */

type Node = {
  text: string;
  id: number;
  x: number;
  y: number;
  output: string | null;
  error: string | null;
};

type Props = {
  nodes: Node[];
};
export default function NodeCanvas({ nodes }: Props) {
  // Copy incoming nodes into local state so that we can update
  // their coordinates on drag without mutating props. Whenever
  // the nodes prop changes in length (e.g. new nodes added), we
  // synchronise the internal state.
  const [internalNodes, setInternalNodes] = useState<Node[]>(nodes);

  useEffect(() => {
    // If the number of nodes changes, update internal state to include
    // new nodes. This does not update coordinates of existing nodes.
    if (nodes.length !== internalNodes.length) {
      setInternalNodes(nodes);
    }
  }, [nodes.length]);

  // Track the current translation (tx, ty) and scaling factor of the
  // canvas. These values represent the transform applied to the
  // container that holds all nodes. We store them in state so that
  // React re-renders whenever the user pans or zooms.
  const [transform, setTransform] = useState<{ tx: number; ty: number; scale: number }>({
    tx: 0,
    ty: 0,
    scale: 1,
  });

  // Reference to the outer container so we can compute its size for
  // initial centering.
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialise the translation to centre the origin (0,0) in the middle
  // of the viewport. This runs after the first render when the
  // container size is available. We also re-run when the number of
  // nodes changes to recalculate the centre.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container) {
      const { clientWidth, clientHeight } = container;
      setTransform((prev) => ({ ...prev, tx: clientWidth / 2, ty: clientHeight / 2 }));
    }
  }, [internalNodes.length]);

  // Panning state: track whether the user is currently panning and the
  // origin of the pan gesture. We store the starting pointer position
  // and the starting translation values in refs to avoid re-renders
  // while the user pans.
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number }>({
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
  });

  // Handler for pointer down on the background (not on a node). This
  // begins a pan gesture. We check that the pointer down target is
  // strictly the container itself to avoid starting a pan when the
  // user interacts with a node. Pointer capture is used to ensure we
  // continue to receive move/up events even if the pointer leaves the
  // element.
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to primary button.
    if (e.button !== 0) { return; }
    // Avoid panning when pressing on child elements (nodes). We test
    // whether the event target is the container itself.
    if (e.currentTarget !== e.target) { return; }
    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.tx,
      ty: transform.ty,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // Update the translation values based on pointer movement during
  // panning.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) { return; }
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setTransform((prev) => ({ ...prev, tx: panStartRef.current.tx + dx, ty: panStartRef.current.ty + dy }));
  };

  // End the panning gesture when the pointer is released or cancelled.
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Mouse wheel handler to implement zooming. Zoom will centre on the
  // pointer location so that the point under the cursor stays in place
  // in world space. We clamp the scaling factor within reasonable
  // bounds to prevent the canvas from becoming too large or too small.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const { clientX, clientY, deltaY } = e;
    const scaleFactor = deltaY < 0 ? 1.1 : 1 / 1.1;
    const minScale = 0.1;
    const maxScale = 4;

    // Compute the world coordinates of the pointer before zooming.
    const worldX = (clientX - transform.tx) / transform.scale;
    const worldY = (clientY - transform.ty) / transform.scale;

    // Apply the zoom factor and clamp.
    const newScale = Math.min(maxScale, Math.max(minScale, transform.scale * scaleFactor));

    // Calculate new translation so that the world coordinate under
    // the pointer stays stationary on screen.
    const newTx = clientX - worldX * newScale;
    const newTy = clientY - worldY * newScale;

    setTransform({ scale: newScale, tx: newTx, ty: newTy });
  };

  // Update a node's position in world coordinates. This is passed
  // down to each DraggableNode and called during dragging. We update
  // state immutably to trigger a re-render.
  const updateNodePosition = (id: number, x: number, y: number) => {
    setInternalNodes((prev) => prev.map((n) => (n.id === id ? { ...n, x, y } : n)));
  };

  // Helpers to zoom in, zoom out and reset view via control buttons.
  const zoomRelative = (factor: number) => {
    const container = containerRef.current;
    if (!container) { return; }
    const { clientWidth, clientHeight } = container;
    // Centre zoom around the middle of the viewport
    const centerX = clientWidth / 2;
    const centerY = clientHeight / 2;
    const worldX = (centerX - transform.tx) / transform.scale;
    const worldY = (centerY - transform.ty) / transform.scale;
    const newScale = Math.min(4, Math.max(0.1, transform.scale * factor));
    const newTx = centerX - worldX * newScale;
    const newTy = centerY - worldY * newScale;
    setTransform({ scale: newScale, tx: newTx, ty: newTy });
  };
  const resetView = () => {
    const container = containerRef.current;
    if (!container) { return; }
    const { clientWidth, clientHeight } = container;
    setTransform((prev) => ({ ...prev, tx: clientWidth / 2, ty: clientHeight / 2, scale: 1 }));
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#fafafa",
        // Draw a light grid in the background to help convey scale
        backgroundImage:
          "linear-gradient(#eee 1px, transparent 1px), linear-gradient(90deg, #eee 1px, transparent 1px)",
        backgroundSize: "50px 50px",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Zoom control buttons. Positioned absolutely in the corner so they
          overlay the canvas. */}
      <div
        style={{ position: "absolute", top: 10, left: 10, zIndex: 1000, display: "flex", gap: 4 }}
      >
        <button onClick={() => zoomRelative(1.1)} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomRelative(1 / 1.1)} aria-label="Zoom out">
          -
        </button>
        <button onClick={resetView} aria-label="Reset view">
          ×
        </button>
      </div>
      {/* Transform wrapper for all nodes. Applying translate and scale
          here means that all child nodes move together when panning
          and zooming. We set transform-origin to top-left (0 0).
          The width and height are intentionally left unset so that
          nodes can live anywhere in world space. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          transform: `translate(${transform.tx}px, ${transform.ty}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
        }}
      >
        {internalNodes.map((node) => (
          <DraggableNode
            key={node.id}
            node={node}
            onUpdatePosition={updateNodePosition}
            scale={transform.scale}
          />
        ))}
      </div>
    </div>
  );
}

// A single draggable node. The node is rendered at its world
// coordinates using absolute positioning. When the user drags the
// node, we convert screen deltas into world deltas by dividing by
// the current scale and update its coordinates via the callback.
function DraggableNode({
  node,
  onUpdatePosition,
  scale,
}: {
  node: Node;
  onUpdatePosition: (id: number, x: number, y: number) => void;
  scale: number;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Track dragging state for this node. We store initial pointer
  // coordinates and the original node position.
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only start dragging on primary button
    if (e.button !== 0) { return; }
    e.stopPropagation();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: node.x,
      origY: node.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) { return; }
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    const newX = dragRef.current.origX + dx;
    const newY = dragRef.current.origY + dy;
    onUpdatePosition(node.id, newX, newY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) { return; }
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <Card
      ref={nodeRef}
      className="canvas-node"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      sx={{
        width: 250,
        p: 2,
        position: "absolute",
        left: node.x,
        top: node.y,
        cursor: dragRef.current ? "grabbing" : "grab",
        userSelect: "none",
      }}
    >
      <CardContent>
        <Typography variant="body1">{node.text}</Typography>
        <Button size="small" onClick={(ev) => {
          ev.stopPropagation();
          setExpanded((prev) => !prev);
        }} sx={{ mt: 1 }}>
          {expanded ? "Hide Runtime Information" : "Show Runtime Information"}
        </Button>
        <Collapse in={expanded}>
          <TextField
            label="Output"
            value={node.output ?? ""}
            fullWidth
            margin="dense"
            InputProps={{ readOnly: true }}
          />
          <TextField
            label="Error"
            value={node.error ?? ""}
            fullWidth
            margin="dense"
            InputProps={{ readOnly: true }}
          />
        </Collapse>
      </CardContent>
    </Card>
  );
}
