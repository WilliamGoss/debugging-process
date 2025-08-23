import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { Card, CardContent, Typography, Button, TextField, Collapse, Box } from "@mui/material";

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
  runOutput: string | null;
  runError: string | null;
  /**
   * Indicates whether the node's runtime info (output/error panels) is
   * currently expanded. When true the card will show the runOutput
   * and runError fields. Persisting this flag on the node allows
   * callers (e.g. the parent React app) to remember the expanded
   * state across renders and even across sessions when coupled with
   * localStorage or extension backed persistence.
   */
  expanded?: boolean;
  /**
   * Indicates whether the output panel overlay is expanded. When true
   * the runOutput overlay is visible. This property must be
   * preserved on the node for persistence.
   */
  outputExpanded?: boolean;
  /**
   * Indicates whether the error panel overlay is expanded. When true
   * the runError overlay is visible. This property must be
   * preserved on the node for persistence.
   */
  errorExpanded?: boolean;
};

/**
 * Properties for the `NodeCanvas` component.  In addition to the list of
 * nodes, callers may provide an optional callback that will be invoked
 * whenever a node's position is updated via dragging. This allows the
 * outer webview to inform the extension about coordinate changes, much
 * like the old D3-based visualization did.
 */
type Props = {
  /**
   * The array of nodes to render. Each node is rendered at its
   * `x`/`y` world coordinate and will display its `text`, `output`
   * and `error` properties. If the array length changes the
   * component will synchronise its internal state accordingly.
   */
  nodes: Node[];
  /**
   * Optional callback fired whenever a node's position is updated
   * through a drag gesture. It receives the node id and the new
   * world coordinates. When not provided the component behaves as
   * before and does not emit any notifications on movement.
   */
  onNodePositionChange?: (id: number, x: number, y: number) => void;
  onNodeDragEnd?: (id: number, x: number, y: number) => void;
  activeNodeId?: number | null;
  onActiveNodeChange?: (id: number) => void;
  /**
   * Callback fired whenever a node's expanded state is toggled.  The
   * caller can update its stored node list accordingly and persist
   * the state.  The boolean indicates the new expanded value.
   */
  onNodeExpansionChange?: (id: number, expanded: boolean) => void;
  /**
   * Callback fired whenever a node's output overlay expanded state is
   * toggled.  When true the output overlay should be visible.
   */
  onNodeOutputExpansionChange?: (id: number, outputExpanded: boolean) => void;
  /**
   * Callback fired whenever a node's error overlay expanded state is
   * toggled.  When true the error overlay should be visible.
   */
  onNodeErrorExpansionChange?: (id: number, errorExpanded: boolean) => void;
};

export default function NodeCanvas({
  nodes,
  onNodePositionChange,
  onNodeDragEnd,
  activeNodeId,
  onActiveNodeChange,
  onNodeExpansionChange,
  onNodeOutputExpansionChange,
  onNodeErrorExpansionChange,
}: Props) {
  // Copy incoming nodes into local state so that we can update
  // their coordinates on drag without mutating props. Whenever
  // the nodes prop changes in length (e.g. new nodes added), we
  // synchronise the internal state.
  /*
  const [internalNodes, setInternalNodes] = useState<Node[]>(nodes);

  useEffect(() => {
    // If the number of nodes changes, update internal state to include
    // new nodes. This does not update coordinates of existing nodes.
    if (nodes.length !== internalNodes.length) {
      setInternalNodes(nodes);
    }
  }, [nodes.length]);
  */

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
  const hasCenteredRef = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || hasCenteredRef.current) { return; }
    const { clientWidth, clientHeight } = container;
    setTransform((prev) => ({ ...prev, tx: clientWidth / 2, ty: clientHeight / 2 }));
    hasCenteredRef.current = true;
  }, []);

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
    // Update our internal copy of the nodes so that dragging produces
    // immediate visual feedback. We do this immutably to trigger a
    // re-render.
    //setInternalNodes((prev: any) => prev.map((n: any) => (n.id === id ? { ...n, x, y } : n)));
    // Notify any external listener about the updated coordinates. This
    // callback is optional and will be used by the webview wrapper to
    // forward coordinate changes back into the VS Code extension.
    if (typeof onNodePositionChange === 'function') {
      onNodePositionChange(id, x, y);
    }
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
        {nodes.map((node) => (
          <DraggableNode
            key={node.id}
            node={node}
            isActive={node.id === activeNodeId}
            onUpdatePosition={updateNodePosition}
            onDragEnd={onNodeDragEnd}
            onSelect={() => onActiveNodeChange?.(node.id)}
            scale={transform.scale}
            expanded={!!node.expanded}
            outputExpanded={!!node.outputExpanded}
            errorExpanded={!!node.errorExpanded}
            onToggleExpand={(val) => onNodeExpansionChange?.(node.id, val)}
            onToggleOutput={(val) => onNodeOutputExpansionChange?.(node.id, val)}
            onToggleError={(val) => onNodeErrorExpansionChange?.(node.id, val)}
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
  onDragEnd,
  scale,
  isActive,
  onSelect,
  /**
   * Whether the node's runtime details (output/error panels) are
   * currently expanded. This is controlled by the parent component
   * so that the expanded state can be persisted in the node itself.
   */
  expanded,
  /** Whether the output overlay is expanded. */
  outputExpanded,
  /** Whether the error overlay is expanded. */
  errorExpanded,
  /** Callback invoked when the expanded flag toggles. */
  onToggleExpand,
  /** Callback invoked when the output overlay toggles. */
  onToggleOutput,
  /** Callback invoked when the error overlay toggles. */
  onToggleError,
}: {
  node: Node;
  isActive?: boolean;
  onUpdatePosition: (id: number, x: number, y: number) => void;
  onDragEnd?: (id: number, x: number, y: number) => void;
  onSelect?: () => void;
  scale: number;
  expanded: boolean;
  outputExpanded: boolean;
  errorExpanded: boolean;
  onToggleExpand: (val: boolean) => void;
  onToggleOutput: (val: boolean) => void;
  onToggleError: (val: boolean) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  // Internal refs used to close overlays when clicking outside. We no
  // longer manage the expanded flags here; instead they are passed
  // down from the parent and toggled via callbacks.

  const hasError = !!(node.runError && String(node.runError).trim().length);


  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    // When an overlay is open, clicking anywhere else should close it. We
    // attach a global pointerdown handler in the capture phase to
    // intercept the event before it reaches other elements. When both
    // overlays are closed we remove the handler to avoid unnecessary
    // work. Note: we intentionally call the provided toggle callbacks
    // with false to notify the parent about the closure.
    if (!errorExpanded && !outputExpanded) { return; }
    const closeOnAnyPointerDown = () => {
      if (errorExpanded) onToggleError(false);
      if (outputExpanded) onToggleOutput(false);
    };
    window.addEventListener("pointerdown", closeOnAnyPointerDown, true);
    return () => window.removeEventListener("pointerdown", closeOnAnyPointerDown, true);
  }, [errorExpanded, outputExpanded, onToggleError, onToggleOutput]);

  const countLines = (text: string | null | undefined) => {
    // normalize newlines, trim trailing newlines, then count
    const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    return Math.max(1, s.length ? s.split("\n").length : 1);
  };
  
  const outputRows = Math.min(5, countLines(node.runOutput));
  const errorRows  = Math.min(5, countLines(node.runError));
  
  

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

    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;
    const finalX = dragRef.current.origX + dx;
    const finalY = dragRef.current.origY + dy;

    onUpdatePosition(node.id, finalX, finalY);
    onDragEnd?.(node.id, finalX, finalY);

    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const hasOutput = !!(node.runOutput && String(node.runOutput).trim().length);

  return (
    <Card
      ref={nodeRef}
      className="canvas-node"
      onDoubleClick={(e) => { e.stopPropagation(); onSelect?.(); }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      sx={{
        width: 250,
        p: 1,
        pt: 0.5,
        m: 0,
        position: "absolute",
        left: node.x,
        top: node.y,
        cursor: dragRef.current ? "grabbing" : "grab",
        userSelect: "none",
        bgcolor: isActive ? "#E3F2FD" : "background.paper",
        border: "2px solid",
        borderColor: isActive ? "#90CAF9" : "divider",
        boxShadow: isActive ? 6 : 1,
        transition: "background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
        overflow: "visible", // required for inline expand
        isolation: "isolate"
      }}
    >
      {/* top-right node chevron */}
      <div
        style={{ position: "absolute", top: 4, right: 4, display: "flex", alignItems: "center", gap: 4 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand(!expanded);
        }}
        role="button"
        aria-label={expanded ? "Collapse runtime info" : "Expand runtime info"}
        title={expanded ? "Collapse" : "Expand"}
      >
        <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d={expanded ? "M4,10 L8,6 L12,10" : "M4,6 L8,10 L12,6"}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
  
      <CardContent sx={{ p: 1, pt: 0.75, "&:last-child": { pb: 1 } }}>
        <Typography variant="body1" sx={{ pr: 2 }}>
          {node.text}
        </Typography>
  
        <Collapse in={expanded} unmountOnExit sx={{ mt: 1 }}>
          <Box onPointerDown={(e) => e.stopPropagation()}>
            {/* OUTPUT */}
            {/* OUTPUT (click the textarea to expand) */}
{hasOutput ? (
  <Box sx={{ position: "relative" }} onPointerDown={(e) => e.stopPropagation()}>
            <TextField
              label="Output"
              value={node.runOutput ?? ""}
              fullWidth
              multiline
              minRows={outputRows}
              maxRows={outputRows}
              margin="dense"
              spellCheck={false}
              inputProps={{ wrap: "off" }} // horizontal scroll
              onClick={() => onToggleOutput(true)} // click to expand
              sx={{
                "& .MuiInputBase-input": {
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "0.85rem",
                  lineHeight: 1.35,
                },
                "& .MuiInputBase-inputMultiline": {
                  whiteSpace: "pre",   // no soft wrap; preserve spaces/newlines
                  overflow: "hidden",
                  maxHeight: 220,      // adjust as needed
                  resize: "none",  // let users resize if they want
                },
                "& textarea": { overflowX: "auto", resize: "none" }, // show horizontal scrollbar
              }}
              InputProps={{ readOnly: true }}
            />

    {/* Expanded panel that auto-sizes to content and collapses on click */}
    {outputExpanded && (
      <Box
        onClick={() => onToggleOutput(false)}
        sx={{
          position: "absolute",
          zIndex: 20,
          top: -8,
          left: -8,

          // shrink-wrap to content; clamp to viewport
          display: "inline-block",
          width: "max-content",
          height: "max-content",
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflow: "auto",

          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          boxShadow: 6,
          p: 1,
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: 8,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.85rem",
            lineHeight: 1.35,
            whiteSpace: "pre",
            display: "block",
          }}
        >
          {node.runOutput ?? ""}
        </pre>
      </Box>
    )}
  </Box>
) : (
  <TextField
    label="Output"
    placeholder="No output was detected"
    fullWidth
    margin="dense"
    disabled
    sx={{
      "& .MuiInputBase-input": {
        fontStyle: "italic",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "0.85rem",
        lineHeight: 1.4,
      },
      "& .MuiInputBase-input::placeholder": {
        fontStyle: "italic",
        color: "text.disabled",
        opacity: 1,
      },
    }}
  />
)}

  
{/* ERROR — only render if there is one */}
{hasError && (
  <Box sx={{ position: "relative" }} onPointerDown={(e) => e.stopPropagation()}>
      <TextField
        label="Error"
        value={node.runError ?? ""}
        fullWidth
        multiline
        minRows={errorRows}
        maxRows={errorRows}
        margin="dense"
        spellCheck={false}
        inputProps={{ wrap: "off" }}
        onClick={() => onToggleError(true)} // safe because hasError is true
        sx={{
          "& .MuiInputBase-input": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.85rem",
            lineHeight: 1.35,
          },
          "& .MuiInputBase-inputMultiline": {
            whiteSpace: "pre",
            overflow: "hidden",
            maxHeight: 200,
            resize: "none",
          },
          "& textarea": { overflowX: "auto", resize: "none" },
        }}
        InputProps={{ readOnly: true }}
      />

    {errorExpanded && (
      <Box
        onClick={() => onToggleError(false)}
        sx={{
          position: "absolute",
          zIndex: 20,
          top: -8,
          left: -8,
          display: "inline-block",
          width: "max-content",
          height: "max-content",
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflow: "auto",
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          boxShadow: 6,
          p: 1,
        }}
      >
        <pre
          style={{
            margin: 0,
            padding: 8,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.85rem",
            lineHeight: 1.35,
            whiteSpace: "pre",
            display: "block",
          }}
        >
          {node.runError ?? ""}
        </pre>
      </Box>
    )}
  </Box>
)}

          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );  
}
