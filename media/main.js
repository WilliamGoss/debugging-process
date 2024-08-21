// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.
(function () {
    // @ts-ignore
    const vscode = acquireVsCodeApi();

    //get node tree state
    const oldState = vscode.getState() || { treeData: {}, nodeCount: 0, activeNode: 0 };
    //const oldState = { treeData: {}, nodeCount: 0, activeNode: 0 };
    let treeData = oldState.treeData;
    let nodeCount = oldState.nodeCount;
    let activeNode = oldState.activeNode;

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
			<textarea name="exploration" cols="40" rows="5"></textarea>
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
            <br/>
            <button id="newChild">New Child Node</button>
        </div>
    `;

    // Call the function to update textarea with the node's name
    updateExplorationText();

    // @ts-ignore: Object is possibly 'null'.
    document.getElementById('startIssue').addEventListener('click', () => {showView('view2'); createNewIssue();});
    /* Overall View */
    // @ts-ignore: Object is possibly 'null'.
    document.getElementById('showTreeButton').addEventListener('click', () => showTree());
    document.getElementById('saveExploration').addEventListener('click', () => updateNodeText());

    /* TESTING ONLY */
    document.getElementById('clearState')?.addEventListener('click', () => emptyState());
    document.getElementById('newChild')?.addEventListener('click', () => createNewChild());

    showView(treeData);

    function showView(treeData) {
        if (JSON.stringify(treeData) === '{}') {
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
                    vscode.setState({treeData: treeData, nodeCount: nodeCount, activeNode: message.data});
                    updateExplorationText();
                    break;
                }
        }
    });

    function createNewIssue() {
        const textAreaObject = document.querySelector('#view1 textarea');
        const userIssueText = textAreaObject.value;
        let newIssueTree = {name: userIssueText, id: nodeCount, children: []};
        treeData = newIssueTree;
        nodeCount = nodeCount + 1;
        vscode.setState({treeData: newIssueTree, nodeCount: nodeCount, activeNode: nodeCount - 1});
        textAreaObject.value = '';
        updateExplorationText();
    }

    /* For testing only! */
    function emptyState() {
        treeData = {};
        nodeCount = 0;
        activeNode = 0;
        vscode.setState({treeData: {}, nodeCount: 0, activeNode: 0});
        showView(treeData);
    }

    function createNewChild() {
        let emptyNode = {name: "New Node", id: nodeCount, children: []};
        nodeCount = nodeCount + 1;
        let newTree = addChildById(treeData, activeNode, emptyNode);
        /* To make child active, it would be activeNode - 1 */
        vscode.setState({treeData: newTree, nodeCount: nodeCount, activeNode: activeNode});
    }

    function showTree() {
        vscode.postMessage({ type: 'showGraph', command: "showD3Graph", treeData: treeData, activeNode: activeNode });
    }

    function updateNodeText() {
        const nodeTextArea = document.querySelector('#view2 textarea[name="exploration"]');
        const nodeText = nodeTextArea.value;
        let newTree = changeNodeText(treeData, activeNode, nodeText);
        vscode.setState({treeData: newTree, nodeCount: nodeCount, activeNode: activeNode});
    }

    function updateExplorationText() {
        // Find the node with the matching id
        const node = findNodeById(treeData, activeNode);
        if (node) {
            // Update the textarea content
            const textarea = document.querySelector('#view2 textarea[name="exploration"]');
            if (textarea) {
                // @ts-ignore
                textarea.value = node.name || ''; // Set the name or empty if not available
            }
        }
    }

    //helper function for finding the correct node
    function findNodeById(node, id) {
        if (node.id === id) {
            return node;
        }
        if (node.children) {
            for (let child of node.children) {
                let result = findNodeById(child, id);
                if (result) {
                    return result;
                }
            }
        }
    }

    //help function for adding children nodes
    function addChildById(tree, id, newChild) {
        // Initialize a queue with the root node
        const queue = [tree];

        while (queue.length > 0) {
            const currentNode = queue.shift(); // Dequeue the first element

            // Check if the current node's id matches
            if (currentNode.id === id) {
                currentNode.children.push(newChild);
                return tree;  // Return the updated tree
            }

            // Enqueue all children of the current node
            for (let child of currentNode.children) {
                queue.push(child);
            }
        }
        
        return tree;  // Return the original tree if it wasn't found
        //Should be an error if this happens!
    }

    //helper function for updating text -- SHOULD REWRITE THE ONE ABOVE TO DO BOTH!!
    function changeNodeText(tree, id, newText) {
        // Initialize a queue with the root node
        const queue = [tree];

        while (queue.length > 0) {
            const currentNode = queue.shift(); // Dequeue the first element

            // Check if the current node's id matches
            if (currentNode.id === id) {
                currentNode.name = newText;
                return tree;  // Return the updated tree
            }

            // Enqueue all children of the current node
            for (let child of currentNode.children) {
                queue.push(child);
            }
        }
        
        return tree;  // Return the original tree if it wasn't found
        //Should be an error if this happens!
    }

}());


