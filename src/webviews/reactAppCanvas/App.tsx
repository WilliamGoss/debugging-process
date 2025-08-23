import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { Card, CardContent, Typography, TextField, Collapse, Box } from "@mui/material";

/*
 * Infinite canvas with pan/zoom + draggable nodes.
 */

type Node = {
  text: string;
  id: number;
  x: number;
  y: number;
  runOutput: string | null;
  runError: string | null;
  expanded?: boolean;
  outputExpanded?: boolean;
  errorExpanded?: boolean;
};

type Props = {
  nodes: Node[];
  onNodePositionChange?: (id: number, x: number, y: number) => void;
  onNodeDragEnd?: (id: number, x: number, y: number) => void;
  activeNodeId?: number | null;
  onActiveNodeChange?: (id: number) => void;
  onNodeExpansionChange?: (id: number, expanded: boolean) => void;
  onNodeOutputExpansionChange?: (id: number, outputExpanded: boolean) => void;
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
  // Slightly zoomed-out default
  const INITIAL_SCALE = 0.75;

  const [transform, setTransform] = useState<{ tx: number; ty: number; scale: number }>({
    tx: 0,
    ty: 0,
    scale: INITIAL_SCALE,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const centeredOnRef = useRef<number | "origin" | null>(null);

  // --- Animation helpers -----------------------------------------------------

  // Keep the latest transform in a ref so the tween always starts from fresh state
  const latestTransformRef = useRef(transform);
  useEffect(() => {
    latestTransformRef.current = transform;
  }, [transform]);

  const easeInOutQuad = (t: number) =>
    (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const animRef = useRef<number | null>(null);
  function cancelAnim() {
    if (animRef.current !== null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
  }
  useEffect(() => () => cancelAnim(), []);

  function animateToTransform(
    target: { tx: number; ty: number; scale: number },
    duration = 350
  ) {
    cancelAnim();
    // Start next frame so we never "snap" in the same frame as layout work
    requestAnimationFrame(() => {
      const start = performance.now();
      const from = { ...latestTransformRef.current };

      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const k = easeInOutQuad(t);
        setTransform({
          tx: from.tx + (target.tx - from.tx) * k,
          ty: from.ty + (target.ty - from.ty) * k,
          scale: from.scale + (target.scale - from.scale) * k,
        });
        if (t < 1) { animRef.current = requestAnimationFrame(step); }
        else { animRef.current = null; }
      };

      animRef.current = requestAnimationFrame(step);
    });
  }

  // --- Initial center + fly-to-active ---------------------------------------

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) { return; }

    // Center the origin once so there's always something visible on first paint
    if (centeredOnRef.current === null) {
      setTransform({
        tx: container.clientWidth / 2,
        ty: container.clientHeight / 2,
        scale: INITIAL_SCALE,
      });
      centeredOnRef.current = "origin";
    }

    // Fly to active node (only once per id)
    if (activeNodeId === null || centeredOnRef.current === activeNodeId) { return; }

    const id = Number(activeNodeId);
    if (!Number.isFinite(id)) { return; }

    const node = nodes.find((n) => Number(n.id) === id);
    if (!node) { return; }

    // Avoid DOM reads: known card size
    const CARD_W = 250;
    const CARD_H = 100;

    // world center of the card
    const wx = node.x + CARD_W / 2;
    const wy = node.y + CARD_H / 2;

    // use the *current* scale, don't snap
    const s = latestTransformRef.current.scale;
    const { clientWidth, clientHeight } = container;

    const target = {
      scale: s,
      tx: clientWidth / 2 - wx * s,
      ty: clientHeight / 2 - wy * s,
    };

    animateToTransform(target, 350);
    centeredOnRef.current = id;
  }, [nodes, activeNodeId]);

  // --- Pan/zoom (cancel any running tween on user interaction) --------------

  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number }>({
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
  });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) { return; }
    if (e.currentTarget !== e.target) { return; } // ignore drags on nodes
    cancelAnim();
    isPanningRef.current = true;
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.tx,
      ty: transform.ty,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) { return; }
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setTransform((prev) => ({
      ...prev,
      tx: panStartRef.current.tx + dx,
      ty: panStartRef.current.ty + dy,
    }));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    cancelAnim();
    const { clientX, clientY, deltaY } = e;
    const scaleFactor = deltaY < 0 ? 1.1 : 1 / 1.1;
    const minScale = 0.1;
    const maxScale = 4;

    const worldX = (clientX - transform.tx) / transform.scale;
    const worldY = (clientY - transform.ty) / transform.scale;

    const newScale = Math.min(maxScale, Math.max(minScale, transform.scale * scaleFactor));
    const newTx = clientX - worldX * newScale;
    const newTy = clientY - worldY * newScale;

    setTransform({ scale: newScale, tx: newTx, ty: newTy });
  };

  // Node drag updates
  const updateNodePosition = (id: number, x: number, y: number) => {
    if (typeof onNodePositionChange === "function") {
      onNodePositionChange(id, x, y);
    }
  };

  const zoomRelative = (factor: number) => {
    const container = containerRef.current;
    if (!container) { return; }
    cancelAnim();
    const { clientWidth, clientHeight } = container;
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
    cancelAnim();
    setTransform({
      tx: container.clientWidth / 2,
      ty: container.clientHeight / 2,
      scale: INITIAL_SCALE,
    });
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

// ---------------------------------------------------------------------------

function DraggableNode({
  node,
  onUpdatePosition,
  onDragEnd,
  scale,
  isActive,
  onSelect,
  expanded,
  outputExpanded,
  errorExpanded,
  onToggleExpand,
  onToggleOutput,
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
  const hasError = !!(node.runError && String(node.runError).trim().length);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    if (!errorExpanded && !outputExpanded) { return; }
    const closeOnAnyPointerDown = () => {
      if (errorExpanded) { onToggleError(false); }
      if (outputExpanded) { onToggleOutput(false); }
    };
    window.addEventListener("pointerdown", closeOnAnyPointerDown, true);
    return () => window.removeEventListener("pointerdown", closeOnAnyPointerDown, true);
  }, [errorExpanded, outputExpanded, onToggleError, onToggleOutput]);

  const countLines = (text: string | null | undefined) => {
    const s = String(text ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    return Math.max(1, s.length ? s.split("\n").length : 1);
  };

  const outputRows = Math.min(5, countLines(node.runOutput));
  const errorRows = Math.min(5, countLines(node.runError));

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
      className="canvas-node"
      data-node-id={node.id}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSelect?.();
      }}
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
        overflow: "visible",
        isolation: "isolate",
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
                  inputProps={{ wrap: "off" }}
                  onClick={() => onToggleOutput(true)}
                  sx={{
                    "& .MuiInputBase-input": {
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: "0.85rem",
                      lineHeight: 1.35,
                    },
                    "& .MuiInputBase-inputMultiline": {
                      whiteSpace: "pre",
                      overflow: "hidden",
                      maxHeight: 220,
                      resize: "none",
                    },
                    "& textarea": { overflowX: "auto", resize: "none" },
                  }}
                  InputProps={{ readOnly: true }}
                />

                {outputExpanded && (
                  <Box
                    onClick={() => onToggleOutput(false)}
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
                  onClick={() => onToggleError(true)}
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
