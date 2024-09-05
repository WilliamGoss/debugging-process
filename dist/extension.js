/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ([
/* 0 */,
/* 1 */
/***/ ((module) => {

module.exports = require("vscode");

/***/ })
/******/ 	]);
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   activate: () => (/* binding */ activate),
/* harmony export */   deactivate: () => (/* binding */ deactivate)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(1);
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);

let graphView = undefined;
function activate(context) {
    const provider = new DebugViewProvider(context.extensionUri);
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.window.registerWebviewViewProvider(DebugViewProvider.viewType, provider));
    // Register the 'showD3Graph' command
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand('extension.showD3Graph', (treeData = {}, activeNode = {}) => {
        if (graphView) {
            graphView.reveal(vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.One);
            graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
            return;
        }
        graphView = vscode__WEBPACK_IMPORTED_MODULE_0__.window.createWebviewPanel('d3Graph', 'D3 Graph', vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.One, {
            enableScripts: true
        });
        graphView.webview.html = getWebviewContent(graphView.webview, context.extensionUri, treeData, activeNode);
        graphView.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'updateActiveNode':
                    provider.receiveInformation("activeNode", message.activeNode);
                    break;
                case 'addNode':
                    provider.receiveInformation("addNode", message.nodeId);
                    break;
            }
        }, undefined, context.subscriptions);
        graphView.onDidDispose(() => {
            graphView = undefined;
        });
    }));
    // Register the 'updateGraph' command
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand('extension.updateGraph', (treeData = {}, activeNode = {}) => {
        if (graphView) {
            graphView.webview.postMessage({ command: 'updateGraph', treeData, activeNode });
        }
        else {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showErrorMessage('No graph panel is currently open.');
        }
    }));
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
function getWebviewContent(webview, extensionUri, treeData, activeNode) {
    const scriptUri = webview.asWebviewUri(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(extensionUri, 'media', 'graph.js'));
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
class DebugViewProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, context, _token) {
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
                        vscode__WEBPACK_IMPORTED_MODULE_0__.commands.executeCommand('extension.showD3Graph', treeData, activeNode);
                        break;
                    }
                case 'updateGraph':
                    {
                        const treeData = data.treeData;
                        const activeNode = data.activeNode;
                        vscode__WEBPACK_IMPORTED_MODULE_0__.commands.executeCommand('extension.updateGraph', treeData, activeNode);
                        break;
                    }
            }
        });
    }
    receiveInformation(command, data) {
        var _a;
        let info = { type: command, data: data };
        (_a = this._view) === null || _a === void 0 ? void 0 : _a.webview.postMessage(info);
    }
    _getHtmlForWebview(webview) {
        // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
        const scriptUri = webview.asWebviewUri(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleResetUri = webview.asWebviewUri(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
        const styleVSCodeUri = webview.asWebviewUri(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
        const styleMainUri = webview.asWebviewUri(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(this._extensionUri, 'media', 'main.css'));
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
DebugViewProvider.viewType = 'debugPanel.panelView';
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
function deactivate() { }

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=extension.js.map