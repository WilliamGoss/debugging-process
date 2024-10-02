// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    //get node tree state
    let nodes;
    let nodeCount;
    let activeNode;
    let root;
    const oldState = vscode.getState() || { nodesData: {root: 0, nodeCount: 0, activeNode: 0, nodes: {}} };
    if ("nodes" in oldState) {
        nodes = oldState.nodes;
        nodeCount = oldState.nodeCount;
        activeNode = oldState.activeNode;
        root = oldState.root;
    } else {
        //stale data
        vscode.setState({root: -1, nodeCount: nodeCount, activeNode: activeNode, nodes: {}});
        nodes = [];
        nodeCount = 0;
        activeNode = 0;
        root = -1;
    }
    //const oldState = { treeData: {}, nodeCount: 0, activeNode: 0 };

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
            <!--
			<button id="saveExploration" disabled>Save Exploration</button>
            -->
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
    //document.getElementById('saveExploration').addEventListener('click', () => createCommit()); 
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
                    let newNode = {name: "New Node", id: nodeCount, commitId: "", children: []};
                    nodes[nodeCount] = newNode;
                    nodes[message.data].children.push(nodeCount);
                    nodeCount = nodeCount + 1;
                    vscode.setState({root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes});
                    let newTree = generateTree(nodes);
                    vscode.postMessage({ type: 'updateGraph', command: "showD3Graph", treeData: newTree, activeNode: activeNode });
                    break;
                }
            case 'attachCommit':
                {
                    const nodeToUpdate = message.data.nodeId;
                    const commitId = message.data.commitId;
                    nodes[nodeToUpdate].commitId = commitId;
                    vscode.setState({root: root, nodeCount: nodeCount, activeNode: activeNode, nodes: nodes});
                    let newTree = generateTree(nodes);
                    vscode.postMessage({ type: 'updateGraph', command: "showD3Graph", treeData: newTree, activeNode: activeNode });
                    break;
                }
            case 'autoCreateNode':
                {
                    console.log('active node is: ' + activeNode);
                    let newNode = {name: message.data, id: nodeCount, commitId: "", children: []};
                    //change active node to the new node
                    let newActiveNode = nodeCount;
                    nodes[nodeCount] = newNode;
                    nodes[activeNode].children.push(nodeCount);
                    nodeCount = nodeCount + 1;
                    activeNode = newActiveNode;
                    vscode.setState({root: root, nodeCount: nodeCount, activeNode: newActiveNode, nodes: nodes});
                    let newTree = generateTree(nodes);
                    vscode.postMessage({ type: 'updateGraph', command: "showD3Graph", treeData: newTree, activeNode: newActiveNode });
                    break;
                }
        }
    });

    function createNewIssue() {
        const textAreaObject = document.querySelector('#view1 textarea');
        const userIssueText = textAreaObject.value;
        let newNodes = {};
        newNodes[0] = {name: userIssueText, id: 0, commitId: "", children: []};
        nodeCount = nodeCount + 1;
        //update the local global variables: nodes, activeNode, root
        nodes = newNodes;
        activeNode = 0;
        root = 0;
        vscode.setState({root: 0, nodeCount: nodeCount, activeNode: 0, nodes: newNodes});
        textAreaObject.value = '';
        updateExplorationText();
        vscode.postMessage({ type: 'initializeRepo' });
    }

    /* For testing only! */
    function emptyState() {
        nodeCount = 0;
        activeNode = 0;
        vscode.setState({root: -1, nodeCount: nodeCount, activeNode: activeNode, nodes: {}});
        showView([]);
        localStorage.clear();
        vscode.postMessage({ type: 'removeRepo' });
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
            //checkChildCommits(node);       
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
                commitId: node.commitId,
                children: node.children.map(childId => buildNode(childId))
            };
        }

        return buildNode(root);
    }

    //save is clicked, so a commit should be saved on the node
    function createCommit() {
        vscode.postMessage({ type: 'createCommit', command: "showD3Graph", activeNode: activeNode });
    }

    //check if any children have commits
    function checkChildCommits(node) {
        let childList = node.children;
        let check = false;
        for (const child of childList) {
            if (nodes[child].commitId !== "") {
                //a child has a commit, so disable saving on the parent
                const saveExplorationButton = document.getElementById('saveExploration');
                if (saveExplorationButton) {
                    saveExplorationButton.disabled = true;
                    check = true;
                    break;
                }
            }
        }
        if (!check) {
            const saveExplorationButton = document.getElementById('saveExploration');
            if (saveExplorationButton) {
                saveExplorationButton.disabled = false;
            }
        }
    }

}());


