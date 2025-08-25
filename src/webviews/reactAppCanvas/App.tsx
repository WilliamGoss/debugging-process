import React, { useRef, useState, useEffect, useLayoutEffect } from "react";
import { Card, CardContent, Typography, TextField, Collapse, Box } from "@mui/material";

/*
 * Infinite canvas with pan/zoom + draggable nodes.
 */

/**
 * A canvas node. In addition to positional and text information we
 * optionally track a user-selected colour for the node. When
 * undefined the UI will fall back to the first entry in the colour
 * palette. The colour property is persisted on the node objects so
 * that parent components (e.g. GraphApp) can update state and
 * optionally persist it across reloads. See `onNodeColorChange` for
 * details on how colour updates propagate.
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
  /** Node background color (CSS string). Falls back to first palette color when undefined. */
  color?: string;
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
  onNodeTextChange?: (id: number, text: string) => void;
  onNodeColorChange?: (id: number, color: string) => void;
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
  onNodeTextChange,
  onNodeColorChange,
}: Props) {
  const INITIAL_SCALE = 0.75;

  const [transform, setTransform] = useState<{ tx: number; ty: number; scale: number }>({
    tx: 0,
    ty: 0,
    scale: INITIAL_SCALE,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const centeredOnRef = useRef<number | "origin" | null>(null);

  // --- Animation helpers -----------------------------------------------------

  const latestTransformRef = useRef(transform);
  useEffect(() => { latestTransformRef.current = transform; }, [transform]);

  const easeInOutQuad = (t: number) =>
    (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  const animRef = useRef<number | null>(null);
  function cancelAnim() {
    if (animRef.current !== null) { cancelAnimationFrame(animRef.current); animRef.current = null; }
  }
  useEffect(() => () => cancelAnim(), []);

  function animateToTransform(
    target: { tx: number; ty: number; scale: number },
    duration = 350
  ) {
    cancelAnim();
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
        if (t < 1) animRef.current = requestAnimationFrame(step);
        else animRef.current = null;
      };
      animRef.current = requestAnimationFrame(step);
    });
  }

  // --- Initial center + fly-to-active ---------------------------------------

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (centeredOnRef.current === null) {
      setTransform({ tx: container.clientWidth / 2, ty: container.clientHeight / 2, scale: INITIAL_SCALE });
      centeredOnRef.current = "origin";
    }

    if (activeNodeId === null || centeredOnRef.current === activeNodeId) return;

    const id = Number(activeNodeId);
    if (!Number.isFinite(id)) return;

    const node = nodes.find((n) => Number(n.id) === id);
    if (!node) return;

    const CARD_W = 250;
    const CARD_H = 100;

    const wx = node.x + CARD_W / 2;
    const wy = node.y + CARD_H / 2;

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

  // --- Pan/zoom --------------------------------------------------------------

  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number }>({ x: 0, y: 0, tx: 0, ty: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.currentTarget !== e.target) return; // only start pan on empty canvas (not children)
    cancelAnim();
    isPanningRef.current = true;
    panStartRef.current = { x: e.clientX, y: e.clientY, tx: transform.tx, ty: transform.ty };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanningRef.current) return;
    e.preventDefault();
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setTransform((prev) => ({ ...prev, tx: panStartRef.current.tx + dx, ty: panStartRef.current.ty + dy }));
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

  const updateNodePosition = (id: number, x: number, y: number) => {
    onNodePositionChange?.(id, x, y);
  };

  const zoomRelative = (factor: number) => {
    const container = containerRef.current;
    if (!container) return;
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
    if (!container) return;
    cancelAnim();
    setTransform({ tx: container.clientWidth / 2, ty: container.clientHeight / 2, scale: INITIAL_SCALE });
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
      <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000, display: "flex", gap: 4 }}>
        <button onClick={() => zoomRelative(1.1)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomRelative(1 / 1.1)} aria-label="Zoom out">-</button>
        <button onClick={resetView} aria-label="Reset view">×</button>
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
            onChangeText={(id, text) => onNodeTextChange?.(id, text)}
            onChangeColor={(id, color) => onNodeColorChange?.(id, color)}
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
  onChangeText,
  onChangeColor,
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
  onChangeText: (id: number, text: string) => void;
  onChangeColor?: (id: number, color: string) => void;
}) {
  const hasError = !!(node.runError && String(node.runError).trim().length);

  // --- Drag & long-press state (card-scoped) ---
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textWrapRef = useRef<HTMLDivElement | null>(null);
  const colorAnchorRef = useRef<HTMLDivElement | null>(null);

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const isDraggingRef = useRef(false);
  const pointerDownRef = useRef(false);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressEligibleRef = useRef(false);

  // NEW: track whether the pointer down started on an area that should open overlay on tap
  const tapKindRef = useRef<null | "output" | "error">(null);

  const PRESS_MS = 450;
  const MOVE_CANCEL_PX = 4;

  useEffect(() => {
    if (!errorExpanded && !outputExpanded) return;
    const closeOnAnyPointerDown = () => {
      if (errorExpanded) onToggleError(false);
      if (outputExpanded) onToggleOutput(false);
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

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  };

  // ---- Card pointer handlers: handle drag + long-press here ----
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;

    const targetEl = e.target as Element | null;

    // Drag surfaces we allow grabbing from
    const inDragSurface = !!targetEl?.closest('[data-drag-surface="true"]');

    // Areas that should open overlay on a tap (no drag)
    const inOutputTap = !!targetEl?.closest('[data-open-on-tap="output"]');
    const inErrorTap  = !!targetEl?.closest('[data-open-on-tap="error"]');
    tapKindRef.current = inOutputTap ? "output" : inErrorTap ? "error" : null;

    // Interactive elements (allow clicks/focus); drag surfaces override.
    const interactiveSelector =
      'select, button, a[href], [role="button"], [role="textbox"], [contenteditable="true"], .MuiButtonBase-root, [data-interactive="true"]';

    const clickedInteractive =
      (!inDragSurface && !!targetEl?.closest(interactiveSelector)) ||
      (colorAnchorRef.current && targetEl && colorAnchorRef.current.contains(targetEl));

    if (clickedInteractive) {
      longPressEligibleRef.current = false;
      cancelLongPress();
      return; // let the control handle the click
    }

    // Start potential drag/long-press. Do NOT preventDefault here—keeps click intact.
    longPressEligibleRef.current =
      !!(textWrapRef.current && targetEl && textWrapRef.current.contains(targetEl));

    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y };
    isDraggingRef.current = false;
    pointerDownRef.current = true;

    try { (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); } catch {}

    cancelLongPress();
    if (longPressEligibleRef.current) {
      longPressTimerRef.current = window.setTimeout(() => {
        if (!pointerDownRef.current || isDraggingRef.current || !longPressEligibleRef.current) return;
        dragRef.current = null;
        try { cardRef.current?.releasePointerCapture(e.pointerId); } catch {}
        setIsEditing(true);
      }, PRESS_MS);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.preventDefault(); // stop native selection while dragging across textareas
    const dx = (e.clientX - dragRef.current.startX) / scale;
    const dy = (e.clientY - dragRef.current.startY) / scale;

    if (!isDraggingRef.current && (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX)) {
      isDraggingRef.current = true;
      cancelLongPress();
    }

    const newX = dragRef.current.origX + dx;
    const newY = dragRef.current.origY + dy;
    onUpdatePosition(node.id, newX, newY);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    cancelLongPress();
    pointerDownRef.current = false;

    // If we never started a dragRef (e.g. long-press switched to edit), just release and maybe open overlay.
    if (!dragRef.current) {
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    } else {
      const dx = (e.clientX - dragRef.current.startX) / scale;
      const dy = (e.clientY - dragRef.current.startY) / scale;
      const finalX = dragRef.current.origX + dx;
      const finalY = dragRef.current.origY + dy;

      onUpdatePosition(node.id, finalX, finalY);
      onDragEnd?.(node.id, finalX, finalY);

      dragRef.current = null;
      try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
    }

    // If it was a TAP (no drag), open the proper overlay now.
    const wasTap = !isDraggingRef.current;
    const tapKind = tapKindRef.current;
    tapKindRef.current = null;

    if (wasTap && tapKind) {
      if (tapKind === "output") onToggleOutput(true);
      else if (tapKind === "error") onToggleError(true);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    cancelLongPress();
    pointerDownRef.current = false;
    dragRef.current = null;
    tapKindRef.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch {}
  };

  // -----------------------------------------------------------------------
  // Color palette + state
  const COLOR_PALETTE = React.useMemo(
    () => [
      "#FFFFFF",
      "#F6C3C1",
      "#FFD79B",
      "#FFEE9D",
      "#D8E9A8",
      "#AEDBF5",
      "#B3DAF5",
      "#D7C4E5",
    ],
    []
  );
  const DEFAULT_COLOR = COLOR_PALETTE[0];
  const cardBg = isActive ? "#E3F2FD" : (node.color ?? DEFAULT_COLOR);
  const currentColor: string = node.color ?? DEFAULT_COLOR;
  const [colorMenuOpen, setColorMenuOpen] = useState(false);

  // Close colour menu on outside click
  useEffect(() => {
    if (!colorMenuOpen) return;
    const handleClose = (e: PointerEvent) => {
      if (!colorAnchorRef.current) { setColorMenuOpen(false); return; }
      const target = e.target as globalThis.Node | null;
      if (target && !colorAnchorRef.current.contains(target)) setColorMenuOpen(false);
    };
    window.addEventListener("pointerdown", handleClose, true);
    return () => window.removeEventListener("pointerdown", handleClose, true);
  }, [colorMenuOpen]);

  const handleSelectColor = (c: string) => {
    if (c === node.color || (c === DEFAULT_COLOR && !node.color)) { setColorMenuOpen(false); return; }
    onChangeColor?.(node.id, c);
    setColorMenuOpen(false);
  };

  const hasOutput = !!(node.runOutput && String(node.runOutput).trim().length);

  // ---------- Inline editing ----------
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(node.text);
  const editRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => { if (!isEditing) setDraft(node.text); }, [node.text, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    const raf = requestAnimationFrame(() => {
      const el = editRef.current; if (!el) return;
      try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      const len = (el as HTMLInputElement | HTMLTextAreaElement).value.length;
      try { (el as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(len, len); }
      catch { (el as any).selectionStart = (el as any).selectionEnd = len; }
    });
    return () => cancelAnimationFrame(raf);
  }, [isEditing]);

  const commit = (save: boolean) => {
    const next = save ? draft : node.text;
    setIsEditing(false);
    setDraft(next);
    if (save && next !== node.text) onChangeText(node.id, next);
  };

  return (
    <Card
      ref={cardRef}
      className="canvas-node"
      data-node-id={node.id}
      onDoubleClick={(e) => { e.stopPropagation(); onSelect?.(); }}
      // Use bubble-phase so clicks on children still work naturally.
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
        bgcolor: cardBg,
        border: "2px solid",
        borderColor: isActive ? "#90CAF9" : "divider",
        boxShadow: isActive
          ? "-12px 6px 18px rgba(32,33,36,.16), 12px 6px 18px rgba(32,33,36,.16), 0 12px 22px rgba(32,33,36,.18)"
          : "0 3px 10px rgba(32,33,36,.12)",
        filter: "none",
        zIndex: 1,
        transition: "background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
        overflow: "visible",
        isolation: "isolate",
      }}
    >
      {/* top-right node chevron */}
      <div
        data-interactive="true"
        style={{ position: "absolute", top: 4, right: 4, display: "flex", alignItems: "center", gap: 4 }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onToggleExpand(!expanded); }}
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
        {!isEditing ? (
          <div ref={textWrapRef} style={{ cursor: "text" }}>
            <Typography variant="body1" sx={{ pr: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {node.text}
            </Typography>
          </div>
        ) : (
          <TextField
            autoFocus
            inputRef={editRef}
            fullWidth
            multiline
            minRows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onBlur={() => commit(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(true); }
              else if (e.key === "Escape") { e.preventDefault(); commit(false); }
            }}
            inputProps={{ spellCheck: false }}
            sx={{ "& .MuiInputBase-input": { fontSize: "1rem", lineHeight: 1.4 } }}
          />
        )}

        <Collapse in={expanded} unmountOnExit sx={{ mt: 1 }}>
          <Box>
            {hasOutput ? (
              <Box sx={{ position: "relative" }}>
                {/* Drag surface + open-on-tap marker */}
                <div
                  data-drag-surface="true"
                  data-open-on-tap="output"
                  style={{ userSelect: "none" }}
                >
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
                    // No onClick needed — tap handled in handlePointerUp via data-open-on-tap
                    sx={{
                      "& .MuiInputBase-input": {
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: "0.85rem",
                        lineHeight: 1.35,
                        cursor: "inherit",
                      },
                      "& .MuiInputBase-inputMultiline": {
                        whiteSpace: "pre",
                        overflow: "hidden",
                        maxHeight: 220,
                        resize: "none",
                        cursor: "inherit",
                      },
                      "& textarea": { overflowX: "auto", resize: "none" },
                    }}
                    InputProps={{ readOnly: true }}
                  />
                </div>

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
              <div data-drag-surface="true" style={{ userSelect: "none" }}>
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
              </div>
            )}

            {hasError && (
              <Box sx={{ position: "relative" }}>
                <div
                  data-drag-surface="true"
                  data-open-on-tap="error"
                  style={{ userSelect: "none" }}
                >
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
                    // No onClick — handled via tap detection in handlePointerUp
                    sx={{
                      "& .MuiInputBase-input": {
                        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontSize: "0.85rem",
                        lineHeight: 1.35,
                        cursor: "inherit",
                      },
                      "& .MuiInputBase-inputMultiline": {
                        whiteSpace: "pre",
                        overflow: "hidden",
                        maxHeight: 200,
                        resize: "none",
                        cursor: "inherit",
                      },
                      "& textarea": { overflowX: "auto", resize: "none" },
                    }}
                    InputProps={{ readOnly: true }}
                  />
                </div>

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

            {/* Colour selector */}
            <Box sx={{ mt: 1 }}>
              <div
                ref={colorAnchorRef as any}
                data-interactive="true"
                style={{ position: "relative", display: "inline-block" }}
              >
                <Box
                  onClick={(e) => { e.stopPropagation(); setColorMenuOpen(!colorMenuOpen); }}
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    bgcolor: currentColor,
                    border: "1px solid",
                    borderColor: "divider",
                    cursor: "pointer",
                  }}
                />
                {colorMenuOpen && (
                  <Box
                    sx={{
                      position: "absolute",
                      top: 32,
                      left: 0,
                      zIndex: 30,
                      bgcolor: "background.paper",
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      boxShadow: 6,
                      p: 1,
                      width: 200,
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 500, mb: 0.5 }}>
                      Colors
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 0.5, mb: 1 }}>
                      {COLOR_PALETTE.map((c) => (
                        <Box
                          key={c}
                          onClick={(e) => { e.stopPropagation(); handleSelectColor(c); }}
                          sx={{
                            width: 20,
                            height: 20,
                            borderRadius: "50%",
                            bgcolor: c,
                            border: c === currentColor ? "2px solid" : "1px solid",
                            borderColor: c === currentColor ? "primary.main" : "divider",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                          }}
                        >
                          {c === currentColor && (
                            <svg width="10" height="10" viewBox="0 0 16 16">
                              <path
                                d="M4,8 L7,11 L12,5"
                                stroke={c === DEFAULT_COLOR ? "#000" : "#fff"}
                                strokeWidth="2"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </Box>
                      ))}
                    </Box>
                    <Box
                      onClick={(e) => { e.stopPropagation(); handleSelectColor(DEFAULT_COLOR); }}
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        px: 0.5,
                        py: 0.75,
                        borderRadius: 1,
                        cursor: "pointer",
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" style={{ marginRight: 6 }}>
                        <path d="M12 4C12 4 7 10 7 14C7 16.7614 9.23858 19 12 19C14.7614 19 17 16.7614 17 14C17 10 12 4 12 4Z" fill="currentColor" />
                        <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
                      </svg>
                      <Typography variant="body2">Reset</Typography>
                    </Box>
                  </Box>
                )}
              </div>
            </Box>
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
