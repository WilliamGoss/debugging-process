// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    //get node tree state
    const oldState = vscode.getState() || { nodesData: {root: 0, nodeCount: 0, activeNode: 0, nodes: {}} };
    console.log(oldState);
    //const oldState = { treeData: {}, nodeCount: 0, activeNode: 0 };
    let nodes = oldState.nodes;
    let nodeCount = oldState.nodeCount;
    let activeNode = oldState.activeNode;
    let root = oldState.root;

    let viewId = '';
    
    document.body.innerHTML = `
        <div id="view1" class="hidden">
            <p>Describe your issue and then click 'Open Issue' to start.</p>
            <br/>
            <textarea cols="40" rows="5"></textarea>
            <br/>
            <button id="startIssue">Open Issue</button>
            <br/>
        </div>
        <div id="view2" class="hidden">
            <p>
			Briefly write what you attempted in this exploration.
			</p>
			<br/>
            <br/>
			<label for="new-exploration">Actions Taken</label>
			<textarea id="explorationText" name="exploration" cols="40" rows="5"></textarea>
            <br/>
			<button id="saveExploration">Save Exploration</button>
            <br/>
            <br/>
            <hr/>
		    <br/>
			<button id="showTreeButton">Show Graph</button>
			<br/>
            <br/>
            <hr/>
            <br/>
            <p>Debug Stuff</p>
            <br/>
            <button id="clearState">Clear State</button>
            <br/>
        </div>
    `;

    // Call the function to update textarea with the node's name
    updateExplorationText();

    // @ts-ignore: Object is possibly 'null'.
    document.getElementById('startIssue').addEventListener('click', () => {showView('view2'); createNewIssue();});
    /* Overall View */
    // @ts-ignore: Object is possibly 'null'.
    document.getElementById('showTreeButton').addEventListener('click', () => showTree(nodes));
    document.getElementById('saveExploration').addEventListener('click', () => updateNodeText());
    //update node text
    document.getElementById('explorationText').addEventListener('input', (event) => updateText(event));

    /* TESTING ONLY */
    document.getElementById('clearState')?.addEventListener('click', () => emptyState());

    showView(nodes);

    function showView(nodes) {
        if (Object.keys(nodes).length === 0) {
            viewId = 'view1';
        } else {
            viewId= 'view2';
        }
        const views = ['view1', 'view2'];
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
                    vscode.setState({root: root, nodeCount: nodeCount, activeNode: message.data, nodes: nodes});
                    updateExplorationText();
                    break;
                }
            case 'addNode':
                {
                    let newNode = {name: "New Node", id: nodeCount, children: []};
                    nodes[nodeCount] = newNode;
                    nodes[message.data].children.push(nodeCount);
                    nodeCount = nodeCount + 1;
                    vscode.setState({root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes});
                    let newTree = generateTree(nodes);
                    vscode.postMessage({ type: 'updateGraph', command: "showD3Graph", treeData: newTree, activeNode: activeNode });
                    break;
                }
        }
    });

    function createNewIssue() {
        const textAreaObject = document.querySelector('#view1 textarea');
        const userIssueText = textAreaObject.value;
        let newNodes = {};
        newNodes[0] = {name: userIssueText, id: 0, children: []};
        nodeCount = nodeCount + 1;
        vscode.setState({root: 0, nodeCount: nodeCount, activeNode: 0, nodes: newNodes});
        textAreaObject.value = '';
        updateExplorationText();
    }

    /* For testing only! */
    function emptyState() {
        nodeCount = 0;
        activeNode = 0;
        vscode.setState({root: -1, nodeCount: nodeCount, activeNode: activeNode, nodes: {}});
        showView([]);
    }

    function showTree(nodes) {
        let treeData = generateTree(nodes);
        vscode.postMessage({ type: 'showGraph', command: "showD3Graph", treeData: treeData, activeNode: activeNode });
    }

    //updates the text in the box with the selected node -- used when a new active node is selected or on the initial extension load
    function updateExplorationText() {
        // Find the node with the matching id
        const node = nodes[activeNode];
        if (node) {
            // Update the textarea content
            const textarea = document.querySelector('#view2 textarea[name="exploration"]');
            if (textarea) {
                // @ts-ignore
                textarea.value = node.name || ''; // Set the name or empty if not available
            }
        }
    }

    function updateText(event) {
        nodes[activeNode].name = event.target.value;
        vscode.setState({root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes});
        vscode.postMessage({ type: 'updateNodeText', command: "showD3Graph", newText: event.target.value, activeNode: activeNode });
    }

    //creates the tree data for the graph
    function generateTree(nodes) {
        function buildNode(nodeId) {
            const node = nodes[nodeId];
            return {
                name: node.name,
                id: node.id,
                children: node.children.map(childId => buildNode(childId))
            };
        }

        return buildNode(root);
    }

}());


