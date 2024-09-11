import * as vscode from 'vscode';

let graphView: vscode.WebviewPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {

    const provider = new DebugViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DebugViewProvider.viewType, provider));

    // Register the 'showD3Graph' command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.showD3Graph', (treeData = {}, activeNode = {}) => {
            if (graphView) {
                graphView.reveal(vscode.ViewColumn.One);
                graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
                return;
            }

            graphView = vscode.window.createWebviewPanel(
                'd3Graph',
                'D3 Graph',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
					//retainContextWhenHidden supposedly can be resource hungry
					retainContextWhenHidden: true
                }
            );

            graphView.webview.html = getWebviewContent(graphView.webview, context.extensionUri, treeData, activeNode);

            graphView.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'updateActiveNode':
                            provider.receiveInformation("activeNode", message.activeNode);
                            break;
                        case 'addNode':
                            provider.receiveInformation("addNode", message.nodeId);
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );

            graphView.onDidDispose(() => {
                graphView = undefined;
            });
        })
    );

    // Register the 'updateGraph' command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.updateGraph', (treeData = {}, activeNode = {}) => {
            if (graphView) {
                graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
            } else {
                vscode.window.showErrorMessage('No graph panel is currently open.');
            }
        })
    );

	// Register the 'updateNodeText' command
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.updateNodeText', (nodeId: number, newText: string) => {
            if (graphView) {
                graphView.webview.postMessage({ command: 'updateNodeText', nodeId, newText });
            } else {
                vscode.window.showErrorMessage('No graph panel is currently open.');
            }
        })
    );
}

/*

export function activate(context: vscode.ExtensionContext) {

    const provider = new DebugViewProvider(context.extensionUri);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DebugViewProvider.viewType, provider));

    //GRAPH
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.showD3Graph', (treeData = {}, activeNode = {}) => {
            const panel = vscode.window.createWebviewPanel(
                'd3Graph',
                'D3 Graph',
                vscode.ViewColumn.One,
                {
                    enableScripts: true
                }
            );

            panel.webview.html = getWebviewContent(panel.webview, context.extensionUri, treeData, activeNode);

			panel.webview.onDidReceiveMessage(
				message => {		
					switch (message.command) {
						case 'updateActiveNode':
							provider.receiveInformation("activeNode", message.activeNode);
							//This closes the webview, but might not want it
							//panel.dispose();
							break;
						case 'addNode':
							provider.receiveInformation("addNode", message.nodeId);
							break;
					}
				},
				undefined,
				context.subscriptions
			);

        })
    );

	context.subscriptions.push(
        vscode.commands.registerCommand('extension.updateGraph', (treeData = {}, activeNode = {}) => {
            // This assumes `panel` is defined in some scope or use appropriate method to access the panel
            // Example of updating an existing webview panel or creating a new one
            const panel = vscode.window.activeWebviewPanel; // Adjust as necessary

            if (panel) {
                panel.webview.postMessage({ command: 'updateGraph', treeData: treeData, activeNode: activeNode });
            }
        })
    );

}

*/

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, treeData: any, activeNode: any) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'graph.js'));

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>D3 Directed Graph</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                overflow: hidden;
            }
            #graph {
                width: 100vw;
                height: 100vh;
                border: 1px solid black;
            }
        </style>
    </head>
    <body>
        <div id="graph">Loading...</div>
        <script type="module">
			const treeData = ${JSON.stringify(treeData)};
			const activeNode = ${activeNode};
			
            import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

            // Load the external script and call createGraph function
            const script = document.createElement('script');
            script.type = 'module';
            script.src = '${scriptUri}';
            document.body.appendChild(script);

            script.onload = () => {
                import('${scriptUri}').then(module => {
                    module.createGraph(treeData, activeNode);
                });
            };
        </script>
    </body>
    </html>`;
}

class DebugViewProvider implements vscode.WebviewViewProvider {

	public static readonly viewType = 'debugPanel.panelView';

	private _view?: vscode.WebviewView;

	constructor(
		private readonly _extensionUri: vscode.Uri,
	) { }

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView;

		webviewView.webview.options = {
			// Allow scripts in the webview
			enableScripts: true,

			localResourceRoots: [
				this._extensionUri
			]
		};

		webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(data => {
			switch (data.type) {
                case 'showGraph':
                    {
						const treeData = data.treeData;
						const activeNode = data.activeNode;
                        vscode.commands.executeCommand('extension.showD3Graph', treeData, activeNode);
                        break;
                    }
				case 'updateGraph':
					{
						const treeData = data.treeData;
						const activeNode = data.activeNode;
						vscode.commands.executeCommand('extension.updateGraph', treeData, activeNode);
						break;
					}
				case 'updateNodeText':
					{
						const activeNode = data.activeNode;
						const newText = data.newText;
						vscode.commands.executeCommand('extension.updateNodeText', activeNode, newText);
					}
			}
		});
	}

	public receiveInformation(command: any, data: any) {
		let info = {type: command, data: data};
		this._view?.webview.postMessage(info);
	}

	private _getHtmlForWebview(webview: vscode.Webview) {
		// Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));

        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

		// Use a nonce to only allow a specific script to be run.
		const nonce = getNonce();

		return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
					Use a content security policy to only allow loading styles from our extension directory,
					and only allow scripts that have a specific nonce.
					(See the 'webview-sample' extension sample for img-src content security policy examples)
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

                <link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">

				<title>Debug</title>
			</head>
				<body>
				<div class="new-bug">
					<label for="new-bug">New Bug:</label>
					<input type="text" id="new-bug" name="new-bug" />
					<br/>
					<button class="add-color-button">Start Session</button>
				</div>
				<br/>
				<hr/>
				<br/>
				<div class="new-attempt">
					<p>
						<b>Bug</b>: No text rendering on page.
					</p>
					<br/>
					<label for="new-attempt">Attempted Solution</label>
					<textarea name="attempt" cols="40" rows="5">
					</textarea>
					<br/>
					<button class="add-color-button">Add ?Checkpoint?</button>
				</div>
				<br/>
				<hr/>
				<br/>
				<button class="show-tree-button">Show D3 Graph</button>
				<br/>
				<ul class="color-list">
				</ul>
				<br/>
				<hr/>
				<br/>
				<p>
				<b>Bug</b>: No text rendering on page.
				</p>
				<br/>
				<div class="attempted-solution">
					<label for="attempt">Attempted Solution</label>
					<textarea name="attempt" cols="40" rows="5">Added print statements to the database call to check and see what data is being returned.?Should this be editable?
					</textarea>
				</div>
				<br/>
				<button class="meow-button">Restore ?Checkpoint?</button>
				<button class="delete-checkpoint-button">?Delete?</button>
	
				<script nonce="${nonce}" src="${scriptUri}"></script>
				<br/>
				<br/>
				</body>
			</html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}



export function deactivate() {}
