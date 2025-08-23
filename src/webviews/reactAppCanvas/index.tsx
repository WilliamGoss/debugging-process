import React, { useEffect, useState } from 'react';
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
 * Entrypoint for the React-based graph canvas. Instead of defining a
 * static set of nodes, this file listens for messages from the
 * extension and updates its internal state accordingly. It mirrors
 * the message-based workflow used by the original D3 visualization.
 */

// Obtain the VS Code API. In the webview context this global is
// available and allows the webview to post messages back to the
// extension. We avoid specifying a type here to keep the code
// framework-agnostic.
//const vscode = acquireVsCodeApi();

// A thin wrapper component that manages the array of nodes and
// coordinates updates. It receives messages from the extension via
// window.postMessage and forwards drag events back to the extension.
function GraphApp() {
  // The list of nodes currently displayed. Each node should include
  // properties such as id, text, x, y, output, error and may also
  // include commitId/branchId/children/visible as provided by the
  // extension.
  const [nodes, setNodes] = useState<any[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);

  /**
   * A map from node id to its persistable UI state (expanded,
   * outputExpanded, errorExpanded). This state is loaded from
   * localStorage on mount so that collapse/expand settings survive
   * reloading or closing of the webview panel. When any
   * expansion-related flag changes we update this map and write it
   * back to localStorage.
   */
  const [expansionState, setExpansionState] = useState<Record<number, { expanded?: boolean; outputExpanded?: boolean; errorExpanded?: boolean }>>(() => {
    if (typeof localStorage === 'undefined') { return {}; }
    try {
      const raw = localStorage.getItem('nodeExpansionStates');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      }
    } catch (e) {
      // ignore parse errors
    }
    return {};
  });

  // Install a message listener on mount. When a message with a
  // recognised command arrives we update our local state. This
  // pattern matches the way the old D3 graph consumed messages.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }
      switch (message.command) {
        case 'updateGraph': {
          // Replace the entire node list with the new tree data. We
          // preserve all properties as provided so that commit ids,
          // branch ids and visibility flags are retained.
          if (Array.isArray(message.treeData)) {
            // Merge any persisted expansion state into the incoming
            // nodes. Each node may have undefined for expansion flags
            // initially; we fill them from our expansionState map to
            // restore UI state.
            setNodes(message.treeData.map((node: any) => {
              const saved = expansionState[node.id] ?? {};
              return {
                ...node,
                expanded: typeof node.expanded === 'boolean' ? node.expanded : saved.expanded,
                outputExpanded: typeof node.outputExpanded === 'boolean' ? node.outputExpanded : saved.outputExpanded,
                errorExpanded: typeof node.errorExpanded === 'boolean' ? node.errorExpanded : saved.errorExpanded,
              };
            }));
          }
          // Accept either a number id or an object with {id}
          const an = message.activeNode;
          if (typeof an === 'number') { setActiveNodeId(an); }
          else if (an && typeof an.id === 'number') { setActiveNodeId(an.id); }
          break;
        }
        case 'updateNodeText': {
          setNodes(prev => prev.map(node => {
            return node.id === message.nodeId ? { ...node, text: message.newText } : node;
          }));
          break;
        }
        case 'attachCommit': {
          setNodes(prev => prev.map(node => {
            return node.id === message.nodeId ? { ...node, commitId: message.commitId, branchId: message.branchId } : node;
          }));
          break;
        }
        case 'hideNode': {
          // Mark the node as not visible. We rely on the render
          // function to filter out nodes with visible=false.
          setNodes(prev => prev.map(node => {
            return node.id === message.nodeId ? { ...node, visible: false } : node;
          }));
          break;
        }
        default:
          // Unknown command; ignore.
          break;
      }
    }
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Forward position updates to the extension. When a node is
  // dragged this callback will be invoked by the canvas component.
  const handlePositionChange = (id: number, x: number, y: number) => {
    setNodes(prev => prev.map(node => (node.id === id ? { ...node, x, y } : node)));
    // Inform the extension about the new position so it can persist
    // the coordinates and update any dependent state.
    //vscode.postMessage({ command: 'updateXY', nodeId: id, x, y });
  };

  // only once when drag ends
  const handleDragEnd = (id: number, x: number, y: number) => {
    // persist or notify extension here
    vscode.postMessage({ command: 'updateXY', nodeId: id, x, y });
  };

  //Changing activeNode
  const handleActiveNodeChange = (id: number) => {
    const node = nodes.find(n => n.id === id);
    setActiveNodeId(id);
    vscode.postMessage({ command: 'updateActiveNode', node: node });
  };

  /**
   * Update helper used by expansion toggles. It updates both the
   * in-memory node list and the persisted expansion map. The
   * callback receives the property name (expanded, outputExpanded,
   * errorExpanded) and the new boolean value.
   */
  const updateExpansionFlag = (id: number, prop: 'expanded' | 'outputExpanded' | 'errorExpanded', value: boolean) => {
    // Update nodes state
    setNodes(prev => prev.map(node => (node.id === id ? { ...node, [prop]: value } : node)));
    // Update persistent map and localStorage
    setExpansionState(prev => {
      const next = { ...prev, [id]: { ...(prev[id] ?? {}), [prop]: value } };
      try {
        localStorage.setItem('nodeExpansionStates', JSON.stringify(next));
      } catch (e) {
        // ignore storage errors
      }
      return next;
    });
  };

  // Only pass nodes that have not been hidden. The `visible` property
  // defaults to true/undefined when omitted.
  const visibleNodes = nodes.filter(node => node.visible !== false);

  return (
    <NodeCanvas
      nodes={visibleNodes}
      activeNodeId={activeNodeId}
      onActiveNodeChange={handleActiveNodeChange}
      onNodePositionChange={handlePositionChange}
      onNodeDragEnd={handleDragEnd}
      onNodeExpansionChange={(id, expanded) => updateExpansionFlag(id, 'expanded', expanded)}
      onNodeOutputExpansionChange={(id, output) => updateExpansionFlag(id, 'outputExpanded', output)}
      onNodeErrorExpansionChange={(id, error) => updateExpansionFlag(id, 'errorExpanded', error)}
    />
  );
}

// Bootstrapping: render the GraphApp into the root element.
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<GraphApp />);
