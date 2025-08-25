import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import NodeCanvas from './App';

type VsCodeApi = {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

declare function acquireVsCodeApi(): VsCodeApi;

const vscode: VsCodeApi = (typeof acquireVsCodeApi === 'function')
  ? acquireVsCodeApi()
  : { postMessage: () => {}, getState: () => undefined, setState: () => {} };

/**
 * Entrypoint for the React-based graph canvas.
 */

function GraphApp() {
  // --- hydrate from VS Code webview state (survives refresh/restoration of the view) ---
  const saved = (() => {
    try { return vscode.getState?.() || {}; } catch { return {}; }
  })();

  const [nodes, setNodes] = useState<any[]>(Array.isArray(saved?.nodes) ? saved.nodes : []);
  const [activeNodeId, setActiveNodeId] = useState<number | null>(
    typeof saved?.activeNodeId === 'number' ? saved.activeNodeId : null
  );

  // Keep a ref to latest nodes to avoid stale closures in merges
  const nodesRef = useRef<any[]>(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // Persist nodes + active id to VS Code state whenever they change
  useEffect(() => {
    try { vscode.setState({ nodes, activeNodeId }); } catch {}
  }, [nodes, activeNodeId]);

  // --- text cache fallback (localStorage) in case backend omits node.text ---
  const textCacheRef = useRef<Record<string, string>>({});
  useEffect(() => {
    try { textCacheRef.current = JSON.parse(localStorage.getItem('nodeTextById') || '{}') || {}; }
    catch { textCacheRef.current = {}; }
  }, []);
  const cacheText = (id: number, text: string) => {
    textCacheRef.current[String(id)] = text;
    try { localStorage.setItem('nodeTextById', JSON.stringify(textCacheRef.current)); } catch {}
  };

  // --- message pump ---
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (!message || typeof message !== 'object') return;

      switch (message.command) {
        case 'updateGraph': {
          if (Array.isArray(message.treeData)) {
            setNodes(prev => {
              const prevMap = new Map(prev.map(n => [n.id, n]));

              const mergedNodes = message.treeData.map((incoming: any) => {
                const id = incoming.id;
                const prevN = prevMap.get(id);

                // Start from previous if present, otherwise a fresh object.
                const merged: any = prevN ? { ...prevN } : {};

                // Copy only defined fields from incoming
                for (const [k, v] of Object.entries(incoming)) {
                  if (v !== undefined) (merged as any)[k] = v;
                }

                // TEXT PRIORITY: incoming.text -> prev.text -> cached text
                if (incoming.text === undefined) {
                  if (prevN?.text !== undefined) {
                    merged.text = prevN.text;
                  } else {
                    const cached = textCacheRef.current[String(id)];
                    if (typeof cached === 'string') merged.text = cached;
                  }
                }

                // Preserve/restore expanded unless backend explicitly sends it
                if (typeof incoming.expanded === 'boolean') {
                  merged.expanded = incoming.expanded;
                } else if (prevN?.expanded !== undefined) {
                  merged.expanded = prevN.expanded;
                //} else if (expansionState[id]?.expanded !== undefined) {
                  //merged.expanded = !!expansionState[id].expanded;
                } else {
                  merged.expanded = !!merged.expanded; // coerce to boolean if present
                }

                // Overlays default closed on load
                merged.outputExpanded = false;
                merged.errorExpanded  = false;

                return merged;
              });

              return mergedNodes;
            });
          }

          const an = message.activeNode;
          if (typeof an === 'number') setActiveNodeId(an);
          else if (an && typeof an.id === 'number') setActiveNodeId(an.id);
          break;
        }

        case 'updateNodeText': {
          // Backend-driven text updates (if any)
          setNodes(prev => prev.map(node =>
            node.id === message.nodeId ? { ...node, text: message.newText } : node
          ));
          cacheText(message.nodeId, message.newText);
          break;
        }

        case 'attachCommit': {
          setNodes(prev => prev.map(node =>
            node.id === message.nodeId
              ? { ...node, commitId: message.commitId, branchId: message.branchId }
              : node
          ));
          break;
        }

        case 'hideNode': {
          setNodes(prev => prev.map(node =>
            node.id === message.nodeId ? { ...node, visible: false } : node
          ));
          break;
        }

        default:
          break;
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // --- UI event handlers ---
  const handlePositionChange = (id: number, x: number, y: number) => {
    setNodes(prev => prev.map(node => (node.id === id ? { ...node, x, y } : node)));
    // vscode.postMessage({ command: 'updateXY', nodeId: id, x, y });
  };

  const handleDragEnd = (id: number, x: number, y: number) => {
    vscode.postMessage({ command: 'updateXY', nodeId: id, x, y });
  };

  const handleActiveNodeChange = (id: number) => {
    const node = nodesRef.current.find(n => n.id === id);
    setActiveNodeId(id);
    vscode.postMessage({ command: 'updateActiveNode', node });
  };

  const handleCardExpandCollapse = (id: number, expandState: boolean) => {
    setNodes(prev => {
      const next = prev.map(n => (n.id === id ? { ...n, expanded: expandState } : n));   
      return next;
    });
    vscode.postMessage({ command: 'updateCardExpandState', nodeId: id, expandState });
  };

  const visibleNodes = nodes.filter(node => node.visible !== false);

  return (
    <NodeCanvas
      nodes={visibleNodes}
      activeNodeId={activeNodeId}
      onActiveNodeChange={handleActiveNodeChange}
      onNodePositionChange={handlePositionChange}
      onNodeDragEnd={handleDragEnd}
      onNodeExpansionChange={handleCardExpandCollapse}
      onNodeOutputExpansionChange={(id, outputExpanded) =>
        setNodes(prev => prev.map(n => (n.id === id ? { ...n, outputExpanded } : n)))
      }
      onNodeErrorExpansionChange={(id, errorExpanded) =>
        setNodes(prev => prev.map(n => (n.id === id ? { ...n, errorExpanded } : n)))
      }
      onNodeTextChange={(id, text) => {
        setNodes(prev => prev.map(n => (n.id === id ? { ...n, text } : n)));
        cacheText(id, text); // ensure we can restore text across reopen
        vscode.postMessage({ command: 'updateNodeText', nodeId: id, nodeText: text });
      }}
      onNodeColorChange={(id, color) => {
        setNodes(prev => prev.map(n => (n.id === id ? { ...n, color } : n)));
        vscode.postMessage({ command: 'updateNodeBackground', nodeId: id, bgColor: color });
      }}
    />
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<GraphApp />);
